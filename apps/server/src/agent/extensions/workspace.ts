import { Type } from "@earendil-works/pi-ai"
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable"
import type { Env } from "../../index"
import { roomStub } from "../../lib/names"
import type { AgentHome } from "../../room/room-do"
import { TASK_TITLE_WORD_LIMIT } from "../../room/task-title"
import { TASK_STATUSES, type WorkspaceAnswer, type WorkspaceCall } from "../../room/workspace"
import { declareEffect } from "@kiko/agent/effects"

export const WORKSPACE = "workspace"

export interface WorkspacePort {
  call(call: WorkspaceCall): Promise<WorkspaceAnswer>
}

const text = (value: string) => [{ type: "text" as const, text: value }]
const answer = (a: WorkspaceAnswer) => (a.ok ? { output: text(a.text) } : { output: text(a.error), isError: true })
const newTaskId = () => `t${crypto.randomUUID().replaceAll("-", "").slice(0, 6)}`

export function workspaceExtension(port: WorkspacePort, lead: boolean): Extension {
  const updateTask = defineTool({
    name: "update_task",
    description:
      "take a task nobody owns by setting it to doing, or change a task you own, with an optional short note. assign a task with owner: \"me\" takes it for you, and a member's handle gives it to that agent. setting doing on an unowned task takes it. set doing before work, done after verifying the result, blocked with a reason when stuck, and review only when the lead must check it. Changes to review, done or blocked automatically notify the lead. Keep titles under 12 words; put findings and file paths in note. Never ask the human to change task status. A refused change returns an error: read it, do not claim the change happened.",
    parameters: Type.Object({
      id: Type.String(),
      status: Type.Union(TASK_STATUSES.map((s) => Type.Literal(s))),
      note: Type.Optional(Type.String()),
      title: Type.Optional(Type.String({ maxLength: 80, description: `action label of at most ${TASK_TITLE_WORD_LIMIT} words, without instructions, handles, or report-to text` })),
      owner: Type.Optional(Type.String({ description: "the agent that owns the task: \"me\" for yourself, or a member's slug without @" })),
    }),
    replay: "safe",
    execute: async (args) =>
      answer(
        await port.call({
          op: "update_task",
          id: args.id,
          status: args.status,
          ...(args.note ? { note: args.note } : {}),
          ...(args.title ? { title: args.title } : {}),
          ...(args.owner ? { owner: args.owner } : {}),
        }),
      ),
  })

  const createTask = defineTool({
    name: "create_task",
    description: "track one meaningful step, not every tool call. Write an action title of fewer than 12 words, without handles, detailed instructions, or report-to text. Assign an owner. A different owner is woken immediately when ready, or when dependencies finish. Keep details in the handoff message or files. Do not create a plan for a simple reply.",
    parameters: Type.Object({
      title: Type.String({ maxLength: 80, description: `at most ${TASK_TITLE_WORD_LIMIT} words; detailed instructions belong in the handoff message or files` }),
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

export function roomWorkspacePort(env: Env, home: () => AgentHome | null): WorkspacePort {
  return {
    async call(call) {
      const h = home()
      if (!h) return { ok: false, error: "this agent has no room yet" }
      return roomStub(env.ROOM, h.userId, h.roomId).workspaceCall(h.slug, call)
    },
  }
}
