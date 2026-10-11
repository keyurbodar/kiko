import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension, type ToolExecutionApi } from "@earendil-works/pi-durable"
import type { AgentSlug } from "@yuki/protocol"
import type { AgentSend } from "../../room/mail"
import type { SpawnInput } from "../../room/room-do"
import { declareEffect } from "@yuki/agent/effects"
import type { Answer } from "@yuki/agent/answers"

export const MESSAGING = "messaging"

export type MessagingPort = {
  send(input: AgentSend): Promise<{ ok: true; to: AgentSlug[] } | { ok: false; error: string }>
  spawn(input: SpawnInput): Promise<{ ok: true; slug: AgentSlug } | { ok: false; error: string }>
  ask(input: AgentSend): Promise<{ ok: true; to: AgentSlug[] } | { ok: false; error: string }>
  askState(id: string): Promise<{ state: "open" | "answered" | "closed"; answer: string | null } | null>
  waitAnswer(id: string, ms: number): Promise<Answer | null>
  closeAsk(id: string): Promise<{ state: "open" | "answered" | "closed"; answer: string | null } | null>
  humanWaiting(): boolean
  team(): Promise<{ slug: AgentSlug; name: string; status: string; doing: string | null; holds: string[] }[]>
}

const text = (t: string) => [{ type: "text" as const, text: t }]

export const ASK_WAIT_MS = 120_000

export function messagingExtension(port: () => MessagingPort | null, lead = false): Extension {
  const room = () => {
    const p = port()
    if (!p) throw new Error("this agent is not in a room yet")
    return p
  }
  const send = async (to: AgentSlug | "all", body: string, api: Pick<ToolExecutionApi, "conversationId" | "callId">) => {
    const out = await room().send({ id: `${api.conversationId}:${api.callId}`, to, text: body })
    return out.ok
      ? { content: text(`sent to ${out.to.map((s) => `@${s}`).join(", ")}. it shows in the chat. if that was all you had to say, reply with just [skip].`) }
      : { content: text(out.error), isError: true }
  }
  const slug = (description: string) => Type.String({ description })

  const spawnTool = declareEffect(
    "message",
    defineTool({
      name: "spawn_agent",
      description:
        "add a new agent to this room as a real member the human can see and talk to, and hand it its first task. use it when the human asks for a new agent, or when the work needs a role nobody here has. the new agent wakes with the task.",
      parameters: Type.Object({
        slug: slug("a short handle, lowercase, like nova or designer"),
        name: Type.Optional(Type.String({ description: "a display name; defaults to the handle" })),
        role: Type.String({ description: "one or two lines on what this agent does and how" }),
        task: Type.String({ description: "its first task, written to it directly" }),
      }),
      replay: "safe",
      execute: async ({ slug: handle, name, role, task }, api) => {
        const out = await room().spawn({ id: `${api.conversationId}:${api.callId}`, slug: handle, name, role, task })
        return out.ok ? { content: text(`@${out.slug} joined the room and has the task.`) } : { content: text(out.error), isError: true }
      },
    }),
  )

  const ask = declareEffect(
    "message",
    defineTool({
      name: "ask",
      description:
        "ask one teammate a question and wait for the answer, which comes back as this tool's result. use it when you need their answer to go on. it waits up to two minutes, and stops at once if the human writes. to ask several teammates, call ask once per teammate in the same reply, and they wait together.",
      parameters: Type.Object({ to: slug("the agent's slug, without @"), question: Type.String() }),
      replay: "safe",
      execute: async ({ to, question }, api) => {
        const id = `${api.conversationId}:${api.callId}`
        const who = to.replace(/^@/, "").toLowerCase() as AgentSlug
        const sent = await room().ask({ id, to: who, text: question })
        if (!sent.ok) return { content: text(sent.error), isError: true }
        const reply = (answer: Answer) => ({ content: text(`@${who} answered: ${answer}`) })
        const answered = (s: { state: string; answer: string | null } | null) => (s?.state === "answered" ? reply(s.answer ?? "") : null)
        const stored = answered(await room().askState(id))
        if (stored) return stored
        const pushed = room().humanWaiting() ? null : await room().waitAnswer(id, ASK_WAIT_MS)
        if (pushed !== null) return reply(pushed)
        const last = answered(await room().closeAsk(id))
        if (last) return last
        const why = room().humanWaiting() ? "the human wrote, so answer them first" : `@${who} has not answered yet`
        return { content: text(`${why}. @${who}'s answer will reach you as a message; go on with what you can.`) }
      },
    }),
  )

  return defineExtension({
    name: MESSAGING,
    tools: [
      ask,
      ...(lead ? [spawnTool] : []),
      declareEffect(
        "message",
        defineTool({
          name: "send_message",
          description:
            "send a message to one agent in this room, or to every other agent with to: all. it shows in the chat and wakes them. a plain reply wakes nobody, so use this to answer a teammate.",
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
            return { content: text(rows.map(line).join("\n")) }
          },
        }),
      ),
    ],
  })
}
