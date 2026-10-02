import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import type { Env } from "../../index"
import { roomStub } from "../../lib/names"
import type { AgentHome } from "../../room/room-do"
import { TASK_STATUSES, type WorkspaceAnswer, type WorkspaceCall } from "../../room/workspace"
import { declareEffect } from "../effects"

// Architecture sections 7.5 and 7.6. The task board, activity log, and notes as agent tools. Every
// tool calls the room's `Workspace` through a `WorkspacePort`, which `AgentDO` binds to its own room
// and slug, so a tool can never act as another agent or in another room. The room reads the caller's
// lead flag from its member row; `create_task` is offered only to the lead and refused for anyone else.
//
// A replayed call is harmless: `create_task` and `post_update` draw their id once per call with
// `api.memo`, and the room stores nothing for a repeated id. Claims and updates are idempotent.

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
  const claimTask = defineTool({
    name: "claim_task",
    description: "take a task on the board as yours. it fails if another agent owns it.",
    parameters: Type.Object({ id: Type.String({ description: "the task id, such as t1a2b3c" }) }),
    replay: "safe",
    execute: async (args) => answer(await port.call({ op: "claim_task", id: args.id })),
  })

  const updateTask = defineTool({
    name: "update_task",
    description:
      "change the status of a task you own, with an optional short note. use review when your part is ready for the lead, done when it is finished.",
    parameters: Type.Object({
      id: Type.String(),
      status: Type.Union(TASK_STATUSES.map((s) => Type.Literal(s))),
      note: Type.Optional(Type.String()),
    }),
    replay: "safe",
    execute: async (args) => answer(await port.call({ op: "update_task", id: args.id, status: args.status, ...(args.note ? { note: args.note } : {}) })),
  })

  const postUpdate = defineTool({
    name: "post_update",
    description: "add one line to the team's activity log, such as progress on a task. it wakes nobody.",
    parameters: Type.Object({ text: Type.String(), task_id: Type.Optional(Type.String()) }),
    replay: "safe",
    execute: async (args, api, context) => {
      const id = await api.memo("activity-id", crypto.randomUUID(), context)
      return answer(await port.call({ op: "post_update", id, text: args.text, ...(args.task_id ? { taskId: args.task_id } : {}) }))
    },
  })

  const writeNote = defineTool({
    name: "write_note",
    description: "save a shared note or decision under a title. writing the same title again replaces it.",
    parameters: Type.Object({ title: Type.String(), body: Type.String() }),
    replay: "safe",
    execute: async (args) => answer(await port.call({ op: "write_note", title: args.title, body: args.body })),
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
    declareEffect("write", claimTask),
    declareEffect("write", updateTask),
    declareEffect("write", postUpdate),
    declareEffect("write", writeNote),
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
