import { Type } from "@earendil-works/pi-ai"
import { type Agent, type AgentChange, configure, defineExtension, defineTool, type Extension, hook, ToolTask, wrapSection } from "@earendil-works/pi-durable"
import { declareEffect } from "@yuki/agent/effects"
import { MAX_WORKERS, type Workers } from "@yuki/agent/workers"
import { MEMORY_NOTE } from "@yuki/memory/tools"
import { CHIEF_EXT } from "./chief"
import { MESSAGING } from "./messaging"
import { REMINDERS } from "./reminders"
import { WORKSPACE } from "./workspace"
import { WORK_LINES } from "../prompt"

// Architecture section 8. The agent talks; workers do slow work in the background. A worker is an
// ownerless conversation in the agent's own harness, so a tool returns at once and the agent's run
// ends while the worker goes on. Its report comes back as a `<work>` input (`@yuki/agent/workers`).

export const WORK = "work"
export const WORK_STEPS = "work-steps"

/** What a worker never gets: more workers, the chat, memory notes, the chief's powers, reminders, the team board. */
export const NOT_FOR_WORKERS: readonly string[] = [WORK, MESSAGING, MEMORY_NOTE, CHIEF_EXT, REMINDERS, WORKSPACE]

const WORKER_PROMPT =
  "You are a background worker. The agent who talks with the human gave you a task. Do it with your tools and check the result. You cannot talk to the human. A later message is the agent passing on a change from the human: follow it. End with a short, complete report of what you found or did."

const say = (text: string) => ({ content: [{ type: "text" as const, text }] })

function workerAgent(agent: Agent): AgentChange {
  return {
    model: agent.model ?? null,
    thinkingLevel: agent.thinkingLevel,
    extensions: agent.extensions.filter((e) => !NOT_FOR_WORKERS.includes(e.name)),
    instructions: WORKER_PROMPT,
  }
}

const brief = (args: unknown) => {
  const text = JSON.stringify(args ?? {})
  return text === "{}" ? "" : ` ${text.length > 80 ? `${text.slice(0, 79)}…` : text}`
}

/** The work tools for the talker, and a hook every conversation keeps so a worker's last step shows. */
export function workExtensions(workers: Workers): Extension[] {
  const start = defineTool({
    name: "start_work",
    description: "Start a background worker on a slow task: browsing, research, several app actions, long drafting. Returns its id at once; its report comes back later as <work>.",
    parameters: Type.Object({ task: Type.String({ description: "The whole task, with everything the worker needs to know" }) }),
    replay: "safe",
    execute: async ({ task }, api, ctx) => {
      const work = workers.byTask(String(api.taskId)) ?? workers.reserve(String(api.taskId), task)
      if (!work) {
        const ids = workers.running().map((w) => w.id).join(", ")
        return say(`${MAX_WORKERS} workers are running (${ids}). wait for one to report, or stop one with stop_work.`)
      }
      let conversationId = work.conversationId
      if (conversationId === null) {
        const agent = workerAgent(await api.agent(ctx))
        conversationId = await api.commit(async (tx) => {
          const created = await tx.createConversation({ ownership: { kind: "ownerless" } })
          await configure(tx, created.id, agent)
          return created.id
        }, ctx)
        workers.placed(work.id, conversationId)
      }
      if (work.submissionId === null) {
        const child = (await api.conversation(conversationId, ctx))!
        const submission = await child.submit({ type: "input", content: task, requestId: `work:${work.id}` }, ctx)
        workers.follow(work.id, submission.id)
      }
      return say(`started ${work.id}. it reports back when done.`)
    },
  })
  const steer = defineTool({
    name: "steer_work",
    description: "Pass a change or an answer to a worker. It reads it after its current step. A worker that already reported takes it up again.",
    parameters: Type.Object({ id: Type.String({ description: "The worker id, such as w1" }), text: Type.String({ description: "What changed, in the human's terms" }) }),
    replay: "safe",
    execute: async ({ id, text }, api, ctx) => {
      const work = workers.get(id)
      const child = work?.conversationId ? await api.conversation(work.conversationId, ctx) : undefined
      if (!work || !child) return say(`there is no worker ${id}.`)
      const submission = await child.submit({ type: "input", content: text, requestId: `steer:${api.taskId}`, whenBusy: "steer" }, ctx)
      workers.follow(id, submission.id)
      return say(work.status === "running" ? `sent to ${id}.` : `${id} took it up again. it reports back when done.`)
    },
  })
  const stop = defineTool({
    name: "stop_work",
    description: "Stop a worker that is no longer wanted.",
    parameters: Type.Object({ id: Type.String({ description: "The worker id, such as w1" }) }),
    replay: "safe",
    execute: async ({ id }) => {
      const work = workers.get(id)
      if (!work) return say(`there is no worker ${id}.`)
      if (work.status !== "running") return say(`${id} already ended: ${work.status}.`)
      workers.stop(id)
      return say(`stopped ${id}.`)
    },
  })
  return [
    defineExtension({ name: WORK, wraps: [wrapSection("work", (slot) => ({ ...slot, render: () => WORK_LINES }))], tools: [declareEffect("write", start), declareEffect("message", steer), declareEffect("write", stop)] }),
    defineExtension({
      name: WORK_STEPS,
      hooks: [
        hook(ToolTask, {
          beforeTool: async (call, api) => {
            workers.step(api.conversationId, `${call.name}${brief(call.arguments)}`)
            return undefined
          },
        }),
      ],
    }),
  ]
}
