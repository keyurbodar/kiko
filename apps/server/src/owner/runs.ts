import * as Schema from "effect/Schema"
const RUN_CALL_LIMIT = 40
const RUN_DURATION_MS = 12 * 60_000
const SHARE_AFTER_CALLS = 3

type RunOutcome = "done" | "continue"

class RunCallLimitError extends Schema.TaggedError<RunCallLimitError>()("RunCallLimitError", {
  message: Schema.String,
}) {}

class RunBudget {
  private outgoing = 0
  private rejected = false
  private readonly sharing = new AbortController()
  readonly deadline: number

  constructor(private readonly now: () => number = Date.now) {
    this.deadline = now() + RUN_DURATION_MS
  }

  get calls(): number {
    return this.outgoing
  }
  count(): void {
    if (this.outgoing >= RUN_CALL_LIMIT) {
      this.rejected = true
      throw new RunCallLimitError({
        message:
          "This run reached its network call budget during a tool. Completed actions were kept. Check those actions before retrying.",
      })
    }
    this.outgoing++
  }
  get shared(): AbortSignal {
    return this.sharing.signal
  }
  share(): void {
    this.sharing.abort()
  }
  due(othersWaiting: () => boolean = () => false): boolean {
    if (this.rejected) return false
    if (this.outgoing >= RUN_CALL_LIMIT || this.now() >= this.deadline) return true
    return this.outgoing >= SHARE_AFTER_CALLS && othersWaiting()
  }
}

type RunsOptions = {
  schedule: (agent: string, requestId: string, behind?: boolean) => Promise<void>
  now?: () => number
}

export class Runs {
  private readonly active = new Map<string, { budget: RunBudget; work: Promise<void> }>()

  constructor(private readonly options: RunsOptions) {}

  start(agent: string, requestId: string): Promise<void> {
    return this.options.schedule(agent, requestId)
  }

  count(agent: string): void {
    this.active.get(agent)?.budget.count()
  }
  countActive(): void {
    const errors: unknown[] = []
    for (const budget of new Set([...this.active.values()].map((a) => a.budget))) {
      try {
        budget.count()
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length) throw errors[0]
  }

  has(agent: string): boolean {
    return this.active.has(agent)
  }

  running(): string | undefined {
    return this.active.keys().next().value
  }

  waiting(agent: string): void {
    for (const [key, { budget }] of this.active) if (key !== agent) budget.share()
  }

  shared(agent: string): AbortSignal | undefined {
    return this.active.get(agent)?.budget.shared
  }

  budget(): RunBudget {
    return new RunBudget(this.options.now)
  }

  run(
    agent: string,
    requestId: string,
    invoke: (budget: RunBudget) => Promise<RunOutcome>,
    budget = this.budget(),
  ): Promise<void> {
    const existing = this.active.get(agent)
    if (existing) return existing.work
    const work = Promise.resolve().then(async () => {
      let outcome: RunOutcome
      try {
        outcome = await invoke(budget)
      } finally {
        this.active.delete(agent)
      }
      if (outcome === "continue") await this.options.schedule(agent, requestId, true)
    })
    this.active.set(agent, { budget, work })
    return work
  }
}
