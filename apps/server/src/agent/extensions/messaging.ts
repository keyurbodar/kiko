import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension, type ToolExecutionApi } from "@earendil-works/pi-durable"
import type { AgentSlug } from "@kiko/protocol"
import type { AgentSend } from "../../room/deliver"
import type { AgentCheck, SpawnInput } from "../../room/room-do"
import { declareEffect } from "../effects"
import { isRunTainted } from "./trust"

// Architecture sections 7.5 and 7.7. The team tools. Every agent message goes through `RoomDO`,
// which stores it in the log, delivers it, and enforces the loop limits. A plain reply bubble
// wakes nobody, so an agent that answers a teammate must call `send_message`. The room sets the
// sender, the hop, and the root; the tool only says who and what, and whether the run is tainted.

export const MESSAGING = "messaging"

/** The room's side of the tools, bound to the calling agent. */
export type MessagingPort = {
  send(input: AgentSend): Promise<{ ok: true; to: AgentSlug[] } | { ok: false; error: string }>
  check(slug: AgentSlug): Promise<AgentCheck | null>
  spawn(input: SpawnInput): Promise<{ ok: true; slug: AgentSlug } | { ok: false; error: string }>
  /** What everyone in the room is doing now and the paths they hold (section 7.12). */
  team(): Promise<{ slug: AgentSlug; name: string; status: string; doing: string | null; holds: string[] }[]>
}

const text = (t: string) => [{ type: "text" as const, text: t }]

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
    return out.ok ? { content: text(`sent to ${out.to.map((s) => `@${s}`).join(", ")}`) } : { content: text(out.error), isError: true }
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

  return defineExtension({
    name: MESSAGING,
    tools: [
      ...(lead ? [spawnTool] : []),
      declareEffect(
        "message",
        defineTool({
          name: "send_message",
          description:
            "send a message to one agent in this room. it shows in the chat and wakes that agent. a plain reply wakes nobody, so use this to answer a teammate.",
          parameters: Type.Object({ to: slug("the agent's slug, without @"), text: Type.String({ description: "the message" }), files }),
          replay: "safe",
          execute: async ({ to, text: body, files: paths }, api) => send(to.replace(/^@/, "") as AgentSlug, body, paths, api),
        }),
      ),
      declareEffect(
        "message",
        defineTool({
          name: "broadcast",
          description: "send one message to every other agent in this room. it shows in the chat and wakes each of them.",
          parameters: Type.Object({ text: Type.String({ description: "the message" }), files }),
          replay: "safe",
          execute: async ({ text: body, files: paths }, api) => send("all", body, paths, api),
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
      declareEffect(
        "read",
        defineTool({
          name: "check_agent",
          description: "read another agent's role, status, and current task from the room. it does not message or wake the agent.",
          parameters: Type.Object({ slug: slug("the agent's slug, without @") }),
          replay: "safe",
          execute: async ({ slug: who }) => {
            const m = await room().check(who.replace(/^@/, "") as AgentSlug)
            if (!m) return { content: text(`no agent @${who} in this room`), isError: true }
            const lines = [
              `@${m.slug} (${m.name})${m.lead ? ", the lead" : ""}`,
              `status: ${m.status}${m.doing ? `, now ${m.doing}` : ""}`,
              ...(m.holds.length ? [`holding: ${m.holds.map((p) => `/${p}`).join(", ")}`] : []),
              `current task: ${m.currentTask ?? "none"}`,
              ...(m.role ? [`role: ${m.role}`] : []),
            ]
            return { content: text(lines.join("\n")) }
          },
        }),
      ),
    ],
  })
}
