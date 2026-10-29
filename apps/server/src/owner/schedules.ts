import type { JsonValue } from "@earendil-works/chord"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import {
  type ConversationId,
  defineDoc,
  defineExtension,
  defineTask,
  type Harness,
  type TaskId,
  type TaskInspection,
} from "@earendil-works/pi-durable"
import { ScheduleError } from "./errors"

export type ScheduledRoutine = { routineId: string; runAt: number; roomId: string; target: string }
export type RoutineDelivery = ScheduledRoutine & { requestId: string }
export type RoutineScheduler = { sync(routines: readonly ScheduledRoutine[]): Promise<void> }

const TASK = "kiko.routine"
const schedules = defineDoc<{ entries: Array<ScheduledRoutine & { taskId: TaskId }> }>({
  kind: "kiko.routine-schedules",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ entries: [] }),
})

const routineRequestId = ({ routineId, runAt }: ScheduledRoutine): string => `${routineId}:${runAt}`

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

  bind(harness: Harness, conversationId: ConversationId): RoutineScheduler {
    return {
      sync: async (routines) => {
        const update = this.updating.then(async () => {
          const current = await harness.snapshot(schedules, conversationId, BACKGROUND_CONTEXT)
          const entries = current?.entries ?? []
          const alive = new Set<string>()
          for (const entry of entries) {
            const task = await harness.getTask(entry.taskId, BACKGROUND_CONTEXT)
            const status = task?.state.status
            if (status !== undefined && status !== "terminal" && status !== "completing")
              alive.add(routineRequestId(entry))
          }
          const keys = new Set(routines.map(routineRequestId))
          if (entries.length === keys.size && [...keys].every((key) => alive.has(key))) return []
          return harness.commit(async (tx) => {
            const doc = await tx.doc(schedules, conversationId)
            const wanted = keys
            const obsolete = doc.entries.filter(
              (entry) => !wanted.has(routineRequestId(entry)) && alive.has(routineRequestId(entry)),
            )
            doc.entries = doc.entries.filter(
              (entry) => wanted.has(routineRequestId(entry)) && alive.has(routineRequestId(entry)),
            )
            const present = new Set(doc.entries.map(routineRequestId))
            for (const input of routines) {
              const key = routineRequestId(input)
              if (present.has(key)) continue
              const taskId = await tx.createTask(this.task, input, {
                ownership: { kind: "conversation" },
                conversationId,
                background: true,
              })
              doc.entries.push({ ...input, taskId })
              present.add(key)
            }
            return obsolete.map((entry) => entry.taskId)
          }, BACKGROUND_CONTEXT)
        })
        this.updating = update.catch(() => {})
        const obsolete = await update
        await Promise.all(
          obsolete.map(async (id) => {
            const task = await harness.getTask(id, BACKGROUND_CONTEXT)
            const checkpoint = task?.state.checkpoint
            if (checkpoint && typeof checkpoint === "object" && "phase" in checkpoint && checkpoint.phase === "deliver")
              return
            await harness.abortTask(id, BACKGROUND_CONTEXT)
          }),
        )
      },
    }
  }
}

export function scheduledDeadline(task: Pick<TaskInspection, "record">): number | undefined {
  if (
    task.record.kind !== TASK ||
    task.record.abortRequested ||
    task.record.state.status === "terminal" ||
    task.record.state.status === "completing"
  )
    return undefined
  const { input, state } = task.record
  const checkpoint = state.checkpoint
  if (!checkpoint || typeof checkpoint !== "object" || !("phase" in checkpoint)) return undefined
  if (
    !input ||
    typeof input !== "object" ||
    !("runAt" in input) ||
    typeof input.runAt !== "number" ||
    !Number.isSafeInteger(input.runAt) ||
    input.runAt < 0
  )
    throw new ScheduleError({
      kind: "deadline",
      taskId: String(task.record.id),
      message: `Invalid routine deadline in task ${task.record.id}`,
    })
  return input.runAt
}

export function captureRoutineTasks(
  tasks: readonly TaskInspection["record"][],
  now = Date.now(),
): ScheduledRoutine[] | null {
  const inputs: ScheduledRoutine[] = []
  for (const task of tasks) {
    if (task.state.status === "terminal" || task.state.status === "completing") return null
    const checkpoint = task.state.checkpoint
    if (
      task.kind !== TASK ||
      task.abortRequested ||
      !task.background ||
      !checkpoint ||
      typeof checkpoint !== "object" ||
      !("phase" in checkpoint) ||
      checkpoint.phase !== "wait"
    )
      return null
    const input = scheduledRoutine(task.input)
    if (input.runAt <= now) return null
    inputs.push(input)
  }
  return inputs
}

export function scheduledRoutine(value: JsonValue): ScheduledRoutine {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.routineId !== "string" ||
    typeof value.roomId !== "string" ||
    typeof value.target !== "string" ||
    typeof value.runAt !== "number" ||
    !Number.isSafeInteger(value.runAt) ||
    value.runAt < 0
  )
    throw new ScheduleError({ kind: "handoff", message: "Invalid routine handoff" })
  return { routineId: value.routineId, roomId: value.roomId, target: value.target, runAt: value.runAt }
}
