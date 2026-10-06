import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension, type ToolExecutionApi } from "@earendil-works/pi-durable"
import type { AgentSlug } from "@kiko/protocol"
import type { AgentSend } from "../../room/mail"
import type { SpawnInput } from "../../room/room-do"
import { declareEffect } from "../effects"
import { isRunTainted } from "./trust"

// Architecture sections 7.5 and 7.7. The team tools: send_message, team, and for the lead spawn_agent. Every agent message goes through `RoomDO`,
// which stores it in the log, delivers it, and enforces the loop limits. A plain reply bubble
// wakes nobody, so an agent that answers a teammate must call `send_message`. The room sets the
// sender, the hop, and the root; the tool only says who and what, and whether the run is tainted.

export const MESSAGING = "messaging"

/** The room's side of the tools, bound to the calling agent. */
export type MessagingPort = {
  send(input: AgentSend): Promise<{ ok: true; to: AgentSlug[] } | { ok: false; error: string }>
  spawn(input: SpawnInput): Promise<{ ok: true; slug: AgentSlug } | { ok: false; error: string }>
  /** `ask`: a message to one teammate whose answer the tool waits for. */
  ask(input: AgentSend): Promise<{ ok: true; to: AgentSlug[] } | { ok: false; error: string }>
  askState(id: string): Promise<{ state: "open" | "answered" | "closed"; answer: string | null } | null>
  /** The answer the room pushes for ask `id`, or null when `ms` passes or the human writes. */
  waitAnswer(id: string, ms: number): Promise<string | null>
  closeAsk(id: string): Promise<{ state: "open" | "answered" | "closed"; answer: string | null } | null>
  /** A human message is waiting: the human outranks a teammate's answer (section 7.8). */
  humanWaiting(): boolean
  /** What everyone in the room is doing now and the paths they hold (section 7.12). */
  team(): Promise<{ slug: AgentSlug; name: string; status: string; doing: string | null; holds: string[] }[]>
}

const text = (t: string) => [{ type: "text" as const, text: t }]

/** How long `ask` waits for a teammate. ASSUMPTION: the number. */
export const ASK_WAIT_MS = 120_000

/** `port` returns null before the room has delivered anything, when the agent has no home yet. */
export function messagingExtension(port: () => MessagingPort | null, lead = false): Extension {
  const room = () => {
    const p = port()
    if (!p) throw new Error("this agent is not in a room yet")
    return p
  }
  // The id is the tool call, so a replayed call stores and delivers nothing new.
  const send = async (to: AgentSlug | "all", body: string, files: readonly string[] | undefined, api: Pick<ToolExecutionApi, "registry" | "conversationId" | "callId">) => {
    const out = await room().send({ id: `${api.conversationId}:${api.callId}`, to, text: body, tainted: isRunTainted(api), ...(files?.length ? { files } : {}) })
    // The chat already shows the message, so a bubble saying it was sent is noise: [skip] posts nothing.
    return out.ok
      ? { content: text(`sent to ${out.to.map((s) => `@${s}`).join(", ")}. it shows in the chat. if that was all you had to say, reply with just [skip].`) }
      : { content: text(out.error), isError: true }
  }
  const slug = (description: string) => Type.String({ description })
  const files = Type.Optional(
    Type.Array(Type.String(), {
      description: "files or folders to hand over, as paths like /notes/plan.md or /drafts. they show on the message, and the recipient reads them with read. nothing is copied: every agent here shares the chat's files.",
    }),
  )

  // Section 7.5. Only the lead grows the team, so only the lead's agent is offered the tool.
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
        const out = await room().spawn({ id: `${api.conversationId}:${api.callId}`, slug: handle, name, role, task, tainted: isRunTainted(api) })
        return out.ok ? { content: text(`@${out.slug} joined the room and has the task.`) } : { content: text(out.error), isError: true }
      },
    }),
  )

  const ask = declareEffect(
    "message",
    defineTool({
      name: "ask",
      description:
        "ask one teammate a question and wait for the answer, which comes back as this tool's result. use it when you need their answer to go on. it waits up to two minutes, and stops at once if the human writes.",
      parameters: Type.Object({ to: slug("the agent's slug, without @"), question: Type.String() }),
      replay: "safe",
      execute: async ({ to, question }, api) => {
        const id = `${api.conversationId}:${api.callId}`
        const who = to.replace(/^@/, "").toLowerCase() as AgentSlug
        const sent = await room().ask({ id, to: who, text: question, tainted: isRunTainted(api) })
        if (!sent.ok) return { content: text(sent.error), isError: true }
        const answered = (s: { state: string; answer: string | null } | null) => (s?.state === "answered" ? { content: text(`@${who} answered: ${s.answer}`) } : null)
        // A replayed call finds an answer that arrived while this object was gone.
        const stored = answered(await room().askState(id))
        if (stored) return stored
        const pushed = room().humanWaiting() ? null : await room().waitAnswer(id, ASK_WAIT_MS)
        if (pushed !== null) return { content: text(`@${who} answered: ${pushed}`) }
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
          parameters: Type.Object({ to: slug("the agent's slug, without @, or all"), text: Type.String({ description: "the message" }), files }),
          replay: "safe",
          execute: async ({ to, text: body, files: paths }, api) => {
            const who = to.replace(/^@/, "").toLowerCase()
            return send(who === "all" ? "all" : (who as AgentSlug), body, paths, api)
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
