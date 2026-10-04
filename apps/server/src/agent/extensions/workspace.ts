import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import type { Env } from "../../index"
import { roomStub } from "../../lib/names"
import type { AgentHome } from "../../room/room-do"
import { TASK_STATUSES, type WorkspaceAnswer, type WorkspaceCall } from "../../room/workspace"
import { declareEffect } from "../effects"

// Architecture sections 7.5 and 7.6. The task board as agent tools. Every
// tool calls the room's `Workspace` through a `WorkspacePort`, which `AgentDO` binds to its own room
// and slug, so a tool can never act as another agent or in another room. The room reads the caller's
// lead flag from its member row; `create_task` is offered only to the lead and refused for anyone else.
//
// A replayed call is harmless: `create_task` draws its id once per call with `api.memo`, and the room
// stores nothing for a repeated id. Updates are idempotent. Decisions go in /chat.md, and what an agent
// did is its run's trace line in memory (section 13), so neither needs a tool here.

export const WORKSPACE = "workspace"

/** What the tools need from the room. Tests pass a fake. */
export interface WorkspacePort {
  call(call: WorkspaceCall): Promise<WorkspaceAnswer>
}

const text = (value: string) => [{ type: "text" as const, text: value }]
const answer = (a: WorkspaceAnswer) => (a.ok ? { content: text(a.text) } : { content: text(a.error), isError: true })
/** A short task id a model can repeat: `t` and six base-36 characters. */
const newTaskId = () => `t${crypto.randomUUID().replaceAll("-", "").slice(0, 6)}`

export function workspaceExtension(port: WorkspacePort, lead: boolean): Extension {
  const updateTask = defineTool({
    name: "update_task",
    description:
      "take a task nobody owns by setting it to doing, or change the status of a task you own, with an optional short note. use review when your part is ready for the lead, done when it is finished.",
    parameters: Type.Object({
      id: Type.String(),
      status: Type.Union(TASK_STATUSES.map((s) => Type.Literal(s))),
      note: Type.Optional(Type.String()),
    }),
    replay: "safe",
    execute: async (args) => answer(await port.call({ op: "update_task", id: args.id, status: args.status, ...(args.note ? { note: args.note } : {}) })),
  })

  const createTask = defineTool({
    name: "create_task",
    description: "add a task to the board, optionally for a member and after other tasks. its owner is woken when every task it depends on is done.",
    parameters: Type.Object({
      title: Type.String(),
      owner: Type.Optional(Type.String({ description: "a member slug, without @" })),
      depends_on: Type.Optional(Type.Array(Type.String(), { description: "ids of tasks that must be done first" })),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
      const id = await api.memo("task-id", newTaskId(), context)
      const owner = args.owner?.replace(/^@/, "")
      return answer(await port.call({ op: "create_task", id, title: args.title, ...(owner ? { owner } : {}), ...(args.depends_on ? { dependsOn: args.depends_on } : {}) }))
    },
  })

  const tools = [
    declareEffect("write", updateTask),
    ...(lead ? [declareEffect("write", createTask)] : []),
  ]
  return defineExtension({ name: WORKSPACE, tools })
}

/** The port over the agent's own room. `home` is read on every call because the room sets it on the first delivery. */
export function roomWorkspacePort(env: Env, home: () => AgentHome | null): WorkspacePort {
  return {
    async call(call) {
      const h = home()
      if (!h) return { ok: false, error: "this agent has no room yet" }
      return roomStub(env.ROOM, h.userId, h.roomId).workspaceCall(h.slug, call)
    },
  }
}
