import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension, type ToolExecutionApi } from "@earendil-works/pi-durable"
import type { AgentSlug, HumanQuestion } from "@kiko/protocol"
import type { AgentSend } from "../../room/mail"
import { declareEffect } from "@kiko/agent/effects"

export const MESSAGING = "messaging"

export type MessagingPort = {
  send(input: AgentSend): Promise<{ ok: true; to: AgentSlug[] } | { ok: false; error: string }>
  askHuman(input: { id: string; question?: string; options?: string[]; questions?: readonly HumanQuestion[] }): Promise<{ ok: true } | { ok: false; error: string }>
  waitAnswer(id: string, ms: number, signal?: AbortSignal): Promise<string | null>
  humanAskState(id: string): Promise<{ state: "open" | "answered" | "skipped"; answer: string | null } | null>
  humanWaiting(): boolean
  team(): Promise<{ slug: AgentSlug; name: string; status: string; doing: string | null; holds: string[] }[]>
}

const text = (t: string) => [{ type: "text" as const, text: t }]

export const ASK_WAIT_MS = 120_000

export function messagingExtension(port: () => MessagingPort | null): Extension {
  const room = () => {
    const p = port()
    if (!p) throw new Error("this agent is not in a room yet")
    return p
  }
  const send = async (to: AgentSlug | "all", body: string, api: Pick<ToolExecutionApi, "conversationId" | "callId">) => {
    const out = await room().send({ id: `${api.conversationId}:${api.callId}`, to, text: body })
    return out.ok
      ? { output: text(`sent to ${out.to.map((s) => `@${s}`).join(", ")}. it shows in the chat, and their answer will reach you as a message. if that was all you had to say, reply with just [skip].`) }
      : { output: text(out.error), isError: true }
  }
  const slug = (description: string) => Type.String({ description })

  const askHuman = declareEffect(
    "message",
    defineTool({
      name: "ask_human",
      description:
        "ask the human one question or a batch of up to eight questions and wait for the answers, which comes back as this tool's result. the human sees your question in the chat and a card over the message box where they select options, type a custom answer in the composer, move between questions, or skip the request. Use questions for a batch, descriptive options, or multiSelect. Each question needs a unique id and a short header. the card shows every question, so write the questions only in this tool, never in a message before or after it. use it only when you cannot go on without their choice. it waits up to two minutes, and stops at once if the human writes something else; a late answer reaches you as a message.",
      parameters: Type.Object({
        question: Type.Optional(Type.String({ description: "one short question; use this or questions" })),
        questions: Type.Optional(Type.Array(Type.Object({
          id: Type.String({ minLength: 1, maxLength: 120 }),
          header: Type.String({ minLength: 1, maxLength: 120 }),
          question: Type.String({ minLength: 1, maxLength: 2000 }),
          options: Type.Array(Type.Object({ label: Type.String({ minLength: 1, maxLength: 120 }), description: Type.Optional(Type.String({ maxLength: 2000 })), value: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })) }), { maxItems: 8 }),
          multiSelect: Type.Optional(Type.Boolean()),
          allowCustomAnswer: Type.Optional(Type.Boolean()),
        }), { minItems: 1, maxItems: 8 })),
        options: Type.Optional(Type.Array(Type.String(), { maxItems: 8, description: "the answers to offer, each a few words. leave out for a free answer" })),
      }),
      replay: "safe",
      execute: async ({ question, options, questions }, api, context) => {
        const id = `${api.conversationId}:${api.callId}`
        const asked = await room().askHuman({ id, ...(question ? { question } : {}), ...(options?.length ? { options } : {}), ...(questions ? { questions } : {}) })
        if (!asked.ok) return { output: text(asked.error), isError: true }
        const settled = (s: { state: string; answer: string | null } | null) =>
          s?.state === "answered" ? { output: text(`the human answered: ${s.answer ?? ""}`) } : s?.state === "skipped" ? { output: text("the human skipped the question. go on without an answer, or ask in your own words later.") } : null
        const stored = settled(await room().humanAskState(id))
        if (stored) return stored
        if (!room().humanWaiting()) await room().waitAnswer(id, ASK_WAIT_MS, context.abortSignal)
        const last = settled(await room().humanAskState(id))
        if (last) return last
        const why = room().humanWaiting() ? "the human wrote something else, so answer them first" : "the human has not answered yet"
        return { output: text(`${why}. the question stays open, and an answer will reach you as a message; go on with what you can.`) }
      },
    }),
  )

  return defineExtension({
    name: MESSAGING,
    tools: [
      askHuman,
      declareEffect(
        "message",
        defineTool({
          name: "send_message",
          description:
            "send a message to one of the human's agents, or to every other agent in this room with to: all. an agent that is not in this room is reached in private, and the exchange shows in this chat. it wakes them. the teammate's answer comes back to you as a message, so you need not wait. a plain reply to a teammate's message is your answer and goes back to them, so use send_message to start a conversation or to say something extra, not to answer.",
          parameters: Type.Object({ to: slug("the agent's slug, without @, or all"), text: Type.String({ description: "the message" }) }),
          replay: "safe",
          execute: async ({ to, text: body }, api) => {
            const who = to.replace(/^@/, "").toLowerCase()
            return send(who === "all" ? "all" : (who as AgentSlug), body, api)
          },
        }),
      ),
      declareEffect(
        "read",
        defineTool({
          name: "team",
          description:
            "who in this room is doing what right now, and the files each is holding. look before you start something a teammate may be on, so two of you never do the same work or touch the same file.",
          parameters: Type.Object({}),
          replay: "safe",
          execute: async () => {
            const rows = await room().team()
            const line = (m: (typeof rows)[number]) =>
              `@${m.slug}: ${m.doing ?? m.status}${m.holds.length ? `, holding ${m.holds.map((p) => `/${p}`).join(", ")}` : ""}`
            return { output: text(rows.map(line).join("\n")) }
          },
        }),
      ),
    ],
  })
}
