import type { TaskId, TaskInspection } from "@earendil-works/pi-durable"

export const RECOVERY_DELAY_MS = 60_000

type AlarmStorage = Pick<DurableObjectStorage, "getAlarm" | "setAlarm" | "deleteAlarm">

export type ClockAgent = {
  id: string
  tasks: readonly TaskInspection[]
  scheduledDeadline: (task: TaskInspection) => number | undefined
}

export type ClockSnapshot = {
  loaded: readonly ClockAgent[]
  unloaded: Iterable<number>
  lease?: number
  hello?: number
  queued?: number
}

/** A runnable task keeps its first recovery deadline until it settles or that alarm fires. */
export class Clock {
  private update: Promise<void> = Promise.resolve()
  private readonly recovery = new Map<string, Map<TaskId, number>>()

  constructor(
    private readonly storage: AlarmStorage,
    private readonly snapshot: () => ClockSnapshot | Promise<ClockSnapshot>,
    private readonly now: () => number = Date.now,
  ) {}

  refresh(): Promise<void> {
    const operation = this.update.then(async () => {
      const snapshot = await this.snapshot()
      const now = this.now()
      let next: number | undefined
      const consider = (at: number | undefined) => {
        if (at !== undefined) next = Math.min(next ?? at, at)
      }
      const agents = new Set<string>()
      for (const agent of snapshot.loaded) {
        agents.add(agent.id)
        const previous = this.recovery.get(agent.id) ?? new Map<TaskId, number>()
        const active = new Map<TaskId, number>()
        for (const task of agent.tasks) {
          if (task.state.kind === "blocked") continue
          const scheduled = agent.scheduledDeadline(task)
          if (scheduled !== undefined && scheduled > now && !task.record.abortRequested) {
            consider(scheduled)
            continue
          }
          const before = previous.get(task.record.id)
          const deadline = before !== undefined && before > now ? before : now + RECOVERY_DELAY_MS
          active.set(task.record.id, deadline)
          consider(deadline)
        }
        this.recovery.set(agent.id, active)
      }
      for (const id of this.recovery.keys()) if (!agents.has(id)) this.recovery.delete(id)
      for (const at of snapshot.unloaded) consider(at)
      consider(snapshot.lease)
      consider(snapshot.hello)
      consider(snapshot.queued)
      const current = await this.storage.getAlarm()
      if (next === undefined) {
        if (current !== null) await this.storage.deleteAlarm()
      } else if (current !== next) await this.storage.setAlarm(next)
    })
    this.update = operation.catch(() => {})
    return operation
  }
}
