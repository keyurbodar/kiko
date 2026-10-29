import { Type } from "@earendil-works/pi-ai"
import {
  type Agent,
  type AgentChange,
  type ConversationId,
  type TaskId,
  type ToolExecutionApi,
  configure,
  defineDoc,
  defineTask,
  defineExtension,
  defineTool,
  type Extension,
  hook,
  ToolTask,
  wrapSection,
} from "@earendil-works/pi-durable"
import { ThinkingLevel } from "@kiko/protocol"
import { declareEffect } from "@kiko/agent/effects"
import { MAX_WORKER_STEPS, MAX_WORKERS, type Workers } from "@kiko/agent/workers"
import { forRole } from "../roles"
import { WORK_LINES } from "../prompt"
import { count } from "../../lib/dev-guard"
import { WORK, WORK_STEPS } from "./names"
import { WorkerMissing } from "../errors"

const WORKER_PROMPT = `You are a background worker in Kiko. An agent who talks with the human gave you one job: do it, then report once at the end.
- Work silently. Your text is not a chat bubble, and you cannot message the human. A later message is that agent passing on a change from the human: follow it.
- End with one report of about 200 words: the answer first, then the evidence, then the path of every file you saved. Never quote a tool error or markup.
- If the job needs an app that is not connected or a key that is missing, stop at once and report only which one is missing. Do not try other routes.`

const say = (text: string) => ({ output: [{ type: "text" as const, text }] })
const sayError = (text: string) => ({ ...say(text), isError: true })

const SPENT = `you used ${MAX_WORKER_STEPS} steps, the most a worker gets. call no more tools. end now with your report, starting "stopped after ${MAX_WORKER_STEPS} steps:" and then what you have so far, with the path of every file you saved.`

const LEVELS = ThinkingLevel.literals

export function workerThinking(parent: ThinkingLevel, asked: ThinkingLevel | undefined): ThinkingLevel {
  if (asked === undefined) return parent
  return LEVELS.indexOf(asked) < LEVELS.indexOf(parent) ? asked : parent
}

function workerAgent(agent: Agent, all: readonly Extension[], thinking?: ThinkingLevel): AgentChange {
  return {
    model: agent.model ?? null,
    thinkingLevel: workerThinking(agent.thinkingLevel, thinking),
    extensions: forRole(all, "worker"),
    instructions: WORKER_PROMPT,
  }
}

const brief = (args: unknown) => {
  const text = JSON.stringify(args ?? {})
  return text === "{}" ? "" : ` ${text.length > 80 ? `${text.slice(0, 79)}…` : text}`
}

const WorkerTasks = defineDoc<{ children: Record<string, ConversationId>; reporters: Record<string, TaskId> }>({
  kind: "kiko.worker-tasks",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ children: {}, reporters: {} }),
})
const WorkerAnchor = defineTask<null, { phase: "done" }, null>({
  name: "kiko.worker-anchor",
  version: 1,
  initial: () => ({ phase: "done" }),
  phases: {
    done: (_task, runtime, context) =>
      runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context),
  },
  abort: (_task, runtime, context) =>
    runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
})

export function workExtensions(
  workers: Workers,
  all: () => readonly Extension[],
  runId: () => string | null = () => null,
): Extension[] {
  const Reporter = defineTask<
    { id: string; conversationId: ConversationId; content: string; requestId: string },
    { phase: "report" },
    null
  >({
    name: "kiko.worker-reporter",
    version: 1,
    initial: () => ({ phase: "report" }),
    phases: {
      report: async (task, runtime, context) => {
        const child = await runtime.conversation(task.input.conversationId, context)
        if (!child) throw new WorkerMissing({ message: "worker conversation missing" })
        const submission = await child.submit(
          { type: "input", content: task.input.content, requestId: task.input.requestId, whenBusy: "steer" },
          context,
        )
        workers.follow(task.input.id, submission.id)
        const settled = await submission.wait(context)
        await workers.complete(task.input.id, submission.id, settled)
        await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context)
      },
    },
    abort: (_task, runtime, context) =>
      runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
  })
  const report = async (
    api: ToolExecutionApi,
    id: string,
    conversationId: ConversationId,
    content: string,
    requestId: string,
    context: Parameters<ToolExecutionApi["agent"]>[0],
  ) => {
    await api.commit(async (tx) => {
      const tasks = await tx.doc(WorkerTasks, api.conversationId)
      if (tasks.reporters[String(api.taskId)] !== undefined) return
      tasks.reporters[String(api.taskId)] = await tx.createTask(
        Reporter,
        { id, conversationId, content, requestId },
        { ownership: { kind: "conversation" }, background: true },
      )
    }, context)
  }
  const start = defineTool({
    name: "start_work",
    description:
      "Start one background worker for a whole job, with everything it needs. Use it for slow work, work with many parts, pages in the browser, or a run of screen steps; do a quick search or one connected-app call yourself. A job with many parts (say, 20 lookups) is one call, since the worker runs the parts at once: never one worker per part or batch. Returns its id at once; its report comes back later as <work>.",
    parameters: Type.Object({
      task: Type.String({ description: "The whole task, with everything the worker needs to know" }),
      thinking: Type.Optional(
        Type.Union(
          LEVELS.map((level) => Type.Literal(level)),
          { description: "how hard the worker thinks, at most your own level; low or minimal suits a lookup" },
        ),
      ),
    }),
    replay: "safe",
    execute: async ({ task, thinking }, api, ctx) => {
      const work = workers.byTask(String(api.taskId)) ?? workers.reserve(String(api.taskId), task, runId())
      if (!work) {
        const ids = workers
          .live()
          .map((w) => w.id)
          .join(", ")
        return sayError(
          `${MAX_WORKERS} workers are running (${ids}). their reports wake you, so end your turn, or stop one with stop_work.`,
        )
      }
      let conversationId = work.conversationId
      if (conversationId === null) {
        const agent = workerAgent(await api.agent(ctx), all(), thinking)
        conversationId = await api.commit(async (tx) => {
          const tasks = await tx.doc(WorkerTasks, api.conversationId)
          const existing = tasks.children[String(api.taskId)]
          if (existing !== undefined) return existing
          const anchor = await tx.createTask(WorkerAnchor, null, {
            ownership: { kind: "conversation" },
            background: true,
          })
          const created = await tx.createConversation({ ownership: { kind: "task", taskId: anchor } })
          await configure(tx, created.id, agent)
          tasks.children[String(api.taskId)] = created.id
          return created.id
        }, ctx)
        workers.placed(work.id, conversationId)
      }
      await report(api, work.id, conversationId, task, `work:${work.id}`, ctx)
      return say(`started ${work.id}. it reports back when done.`)
    },
  })
  const steer = defineTool({
    name: "steer_work",
    description:
      "Pass a change or an answer to a worker. It reads it after its current step. A worker that already reported takes it up again.",
    parameters: Type.Object({
      id: Type.String({ description: "The worker id, such as w1" }),
      text: Type.String({ description: "What changed, in the human's terms" }),
    }),
    replay: "safe",
    execute: async ({ id, text }, api, ctx) => {
      const work = workers.get(id)
      const child = work?.conversationId ? await api.conversation(work.conversationId, ctx) : undefined
      if (!work || !child || !work.conversationId) return say(`there is no worker ${id}.`)
      if (work.status !== "running") {
        const agent = workerAgent(await api.agent(ctx), all())
        const conversationId = work.conversationId
        await api.commit((tx) => configure(tx, conversationId, agent), ctx)
      }
      await report(api, id, work.conversationId, text, `steer:${api.taskId}`, ctx)
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
      if (work.status !== "running" && work.status !== "pending") return say(`${id} already ended: ${work.status}.`)
      void workers.stop(id)
      return say(`stopped ${id}.`)
    },
  })
  return [
    defineExtension({
      name: WORK,
      tasks: [WorkerAnchor, Reporter],
      wraps: [wrapSection("work", (slot) => ({ ...slot, render: () => WORK_LINES }))],
      tools: [declareEffect("write", start), declareEffect("message", steer), declareEffect("write", stop)],
    }),
    defineExtension({
      name: WORK_STEPS,
      hooks: [
        hook(ToolTask, {
          beforeTool: async (call, api) => {
            const taken = workers.step(api.conversationId, `${call.name}${brief(call.arguments)}`)
            count(`tool.${taken === "talker" ? "talker" : "worker"}.${call.name}`)
            return taken === "spent" ? { block: SPENT } : undefined
          },
        }),
      ],
    }),
  ]
}
