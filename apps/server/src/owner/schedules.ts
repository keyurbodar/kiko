import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import { type ConversationId, defineDoc, defineExtension, defineTask, type Harness, type TaskId, type TaskInspection } from "@earendil-works/pi-durable"

export type ScheduledRoutine = { routineId: string; runAt: number; roomId: string; target: string }
export type RoutineDelivery = ScheduledRoutine & { requestId: string }
export type RoutineScheduler = { sync(routines: readonly ScheduledRoutine[]): Promise<void> }

const TASK = "kiko.routine"
const schedules = defineDoc<{ entries: Array<ScheduledRoutine & { taskId: TaskId }> }>({
  kind: "kiko.routine-schedules", version: 1, scope: "conversation", history: "latest", fork: "initial", initial: () => ({ entries: [] }),
})

const routineRequestId = ({ routineId, runAt }: ScheduledRoutine): string => `${routineId}:${runAt}`

/** One instance per Harness. The callback must durably deduplicate requestId before acknowledging delivery. */
export class RoutineSchedules {
  private updating: Promise<unknown> = Promise.resolve()
  readonly task
  readonly extension

  constructor(deliver: (input: RoutineDelivery, signal: AbortSignal) => Promise<void>) {
    this.task = defineTask<ScheduledRoutine, { phase: "wait" } | { phase: "deliver" }, null>({
      name: TASK,
      version: 1,
      initial: () => ({ phase: "wait" }),
      phases: {
        wait: async (task, runtime, context) => {
          await runtime.sleep(task.input.runAt, context)
          await runtime.commit(() => ({ status: "running", checkpoint: { phase: "deliver" } }), context)
        },
        deliver: async (task, runtime, context) => {
          await deliver({ ...task.input, requestId: routineRequestId(task.input) }, runtime.signal)
          await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context)
        },
      },
      abort: async (_task, runtime, context) => {
        await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context)
      },
    })
    this.extension = defineExtension({ name: "kiko.routines", tasks: [this.task] })
  }

  /** Bind to a stable conversation and pass the complete active time-routine inventory on every CRUD change. */
  bind(harness: Harness, conversationId: ConversationId): RoutineScheduler {
    return { sync: async (routines) => {
      const update = this.updating.then(() => harness.commit(async (tx) => {
        const doc = await tx.doc(schedules, conversationId)
        const wanted = new Set(routines.map(routineRequestId))
        const obsolete = doc.entries.filter((entry) => !wanted.has(routineRequestId(entry)))
        doc.entries = doc.entries.filter((entry) => wanted.has(routineRequestId(entry)))
        const present = new Set(doc.entries.map(routineRequestId))
        for (const input of routines) {
          const key = routineRequestId(input)
          if (present.has(key)) continue
          const taskId = await tx.createTask(this.task, input, { ownership: { kind: "conversation" }, conversationId, background: true })
          doc.entries.push({ ...input, taskId })
          present.add(key)
        }
        return obsolete.map((entry) => entry.taskId)
      }, BACKGROUND_CONTEXT))
      this.updating = update.catch(() => {})
      // An active callback can sync its successor while abortTask joins that callback.
      const obsolete = await update
      await Promise.all(obsolete.map(async (id) => {
        const task = await harness.getTask(id, BACKGROUND_CONTEXT)
        const checkpoint = task?.state.checkpoint
        // A delivery removes its own occurrence while committing the next one.
        if (checkpoint && typeof checkpoint === "object" && "phase" in checkpoint && checkpoint.phase === "deliver") return
        await harness.abortTask(id, BACKGROUND_CONTEXT)
      }))
    } }
  }
}

export function scheduledDeadline(task: TaskInspection): number | undefined {
  if (task.record.kind !== TASK || task.record.abortRequested || task.record.state.status === "terminal" || task.record.state.status === "completing") return undefined
  const { input, state } = task.record
  const checkpoint = state.checkpoint
  if (!checkpoint || typeof checkpoint !== "object" || !("phase" in checkpoint) || checkpoint.phase !== "wait") return undefined
  if (!input || typeof input !== "object" || !("runAt" in input) || typeof input.runAt !== "number" || !Number.isSafeInteger(input.runAt) || input.runAt < 0) throw new Error(`Invalid routine deadline in task ${task.record.id}`)
  return input.runAt
}
