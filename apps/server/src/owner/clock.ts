import type { TaskId, TaskInspection } from "@earendil-works/pi-durable"

export const RECOVERY_DELAY_MS = 60_000

type AlarmStorage = Pick<DurableObjectStorage, "getAlarm" | "setAlarm" | "deleteAlarm">

type ClockAgent = {
  id: string
  tasks: readonly TaskInspection[]
  scheduledDeadline: (task: TaskInspection) => number | undefined
}

type ClockSnapshot = {
  loaded: readonly ClockAgent[]
  unloaded: Iterable<number>
  lease?: number
  hello?: number
  queued?: number
  burst?: number
}

export class Clock {
  private update: Promise<void> = Promise.resolve()
  private readonly recovery = new Map<string, Map<TaskId, number>>()

  constructor(
    private readonly storage: AlarmStorage,
    private readonly snapshot: () => ClockSnapshot | Promise<ClockSnapshot>,
    private readonly now: () => number = Date.now,
  ) {}

  private considerLoaded(snapshot: ClockSnapshot, now: number, consider: (at: number | undefined) => void): void {
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
  }

  refresh(): Promise<void> {
    const operation = this.update.then(async () => {
      const snapshot = await this.snapshot()
      const now = this.now()
      let next: number | undefined
      const consider = (at: number | undefined) => {
        if (at !== undefined) next = Math.min(next ?? at, at)
      }
      this.considerLoaded(snapshot, now, consider)
      for (const at of snapshot.unloaded) consider(at)
      consider(snapshot.lease)
      consider(snapshot.hello)
      consider(snapshot.queued)
      consider(snapshot.burst)
      const current = await this.storage.getAlarm()
      if (next === undefined) {
        if (current !== null) await this.storage.deleteAlarm()
      } else if (current !== next) await this.storage.setAlarm(next)
    })
    this.update = operation.catch(() => {})
    return operation
  }
}

export type ClockMetadata = {
  get(key: string): string | null
  set(key: string, value: string): void
  delete(key: string): void
}

export function createServiceClock({ metadata, publish, derived = () => ({}) }: {
  metadata: ClockMetadata
  derived?: () => Record<string, number | undefined>
  publish(at: number | undefined, persist: () => void): Promise<void>
}): import("@kiko/durable/clock-port").ClockPort {
  const stored = (): Record<string, number> => {
    const value = metadata.get("clock:application")
    return value ? JSON.parse(value) : {}
  }
  const read = () => ({ ...stored(), ...derived() })
  let update = Promise.resolve()
  const change = (apply: (deadlines: Record<string, number>) => void): Promise<void> => {
    const next = update.then(async () => {
      const deadlines = stored()
      const before = JSON.stringify(deadlines)
      apply(deadlines)
      const after = JSON.stringify(deadlines)
      const at = Math.min(...Object.values(deadlines))
      await publish(Number.isFinite(at) ? at : undefined, () => {
        if (before === after) return
        if (Object.keys(deadlines).length) metadata.set("clock:application", after)
        else metadata.delete("clock:application")
      })
    })
    update = next.catch(() => {})
    return next
  }
  return {
    deadline: (key) => read()[key],
    setWakeup: (key, at) => change((deadlines) => { if (key in derived()) delete deadlines[key]; else deadlines[key] = at }),
    clearWakeup: (key) => change((deadlines) => { delete deadlines[key] }),
    dueWakeups: async (now) => Object.entries(read()).flatMap(([key, at]) => at !== undefined && at <= now ? [{ key, at }] : []).sort((a, b) => a.at - b.at || a.key.localeCompare(b.key)).map(({ key }) => key),
  }
}

export async function runDue(
  clock: import("@kiko/durable/clock-port").ClockPort,
  due: readonly string[],
  handlers: Readonly<Record<string, () => unknown>>,
): Promise<string[]> {
  const errors: unknown[] = []
  for (const key of due) {
    const handler = handlers[key]
    const at = clock.deadline(key)
    try {
      await handler?.()
      if (clock.deadline(key) === at) await clock.clearWakeup(key)
    }
    catch (error) {
      errors.push(error)
      console.error(`clock ${key} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (errors.length) throw new AggregateError(errors, "Clock handlers failed")
  return []
}

export function projectRecovery(
  tasks: readonly TaskInspection[],
  watches: ReadonlyMap<TaskId, number>,
  current: number | undefined,
  now: number,
  scheduledDeadline: (task: TaskInspection) => number | undefined,
): { next: number | undefined; resume: { id: TaskId; deadline: number }[] } {
  let next: number | undefined
  const resume: { id: TaskId; deadline: number }[] = []
  for (const task of tasks) {
    if (task.state.kind === "blocked") continue
    const scheduled = scheduledDeadline(task)
    const future = scheduled !== undefined && scheduled > now && !task.record.abortRequested
    const before = watches.get(task.record.id) ?? Math.min(current ?? Infinity, now + RECOVERY_DELAY_MS)
    const fallback = before > now ? before : now + RECOVERY_DELAY_MS
    const deadline = future ? scheduled : fallback
    if (future) next = Math.min(next ?? deadline, deadline)
    if (!future) resume.push({ id: task.record.id, deadline: fallback })
  }
  return { next, resume }
}
