import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import type { Env } from "../../index"
import { roomStub } from "../../lib/names"
import type { AgentHome } from "../../room/room-do"
import { TASK_STATUSES, type WorkspaceAnswer, type WorkspaceCall } from "../../room/workspace"
import { declareEffect } from "@yuki/agent/effects"
import { isRunTainted } from "@yuki/agent/trust"

export const WORKSPACE = "workspace"

export interface WorkspacePort {
  call(call: WorkspaceCall): Promise<WorkspaceAnswer>
}

const text = (value: string) => [{ type: "text" as const, text: value }]
const answer = (a: WorkspaceAnswer) => (a.ok ? { content: text(a.text) } : { content: text(a.error), isError: true })
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
    execute: async (args, api) => answer(await port.call({ op: "update_task", id: args.id, status: args.status, ...(args.note ? { note: args.note } : {}), tainted: isRunTainted(api) })),
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
      return answer(await port.call({ op: "create_task", id, title: args.title, ...(owner ? { owner } : {}), ...(args.depends_on ? { dependsOn: args.depends_on } : {}), tainted: isRunTainted(api) }))
    },
  })

  const tools = [
    declareEffect("write", updateTask),
    ...(lead ? [declareEffect("write", createTask)] : []),
  ]
  return defineExtension({ name: WORKSPACE, tools })
}

export function roomWorkspacePort(env: Env, home: () => AgentHome | null): WorkspacePort {
  return {
    async call(call) {
      const h = home()
      if (!h) return { ok: false, error: "this agent has no room yet" }
      return roomStub(env.ROOM, h.userId, h.roomId).workspaceCall(h.slug, call)
    },
  }
}
