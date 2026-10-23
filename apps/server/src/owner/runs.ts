const RUN_CALL_LIMIT = 40
const RUN_DURATION_MS = 12 * 60_000

type RunOutcome = "done" | "continue"

class RunCallLimitError extends Error {
  constructor() {
    super(
      "This run reached its network call budget during a tool. Completed actions were kept. Check those actions before retrying.",
    )
    this.name = "RunCallLimitError"
  }
}

class RunBudget {
  private outgoing = 0
  private rejected = false
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
      throw new RunCallLimitError()
    }
    this.outgoing++
  }
  due(): boolean {
    return !this.rejected && (this.outgoing >= RUN_CALL_LIMIT || this.now() >= this.deadline)
  }
}

type RunsOptions = {
  schedule: (agent: string, requestId: string) => Promise<void>
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
      if (outcome === "continue") await this.options.schedule(agent, requestId)
    })
    this.active.set(agent, { budget, work })
    return work
  }
}
