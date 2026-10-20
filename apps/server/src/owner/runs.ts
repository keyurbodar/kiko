const RUN_CALL_LIMIT = 40
const RUN_DURATION_MS = 12 * 60_000

type RunOutcome = "done" | "continue"

class RunCallLimitError extends Error {
  constructor() {
    super("This run reached its network call budget during a tool. Completed actions were kept. Check those actions before retrying.")
    this.name = "RunCallLimitError"
  }
}

/** Instrumented network admissions, including retries; opaque SDK traffic cannot be counted here. */
export class RunBudget {
  private outgoing = 0
  private rejected = false
  readonly deadline: number

  constructor(private readonly now: () => number = Date.now) {
    this.deadline = now() + RUN_DURATION_MS
  }

  get calls(): number { return this.outgoing }
  count(): void {
    if (this.outgoing >= RUN_CALL_LIMIT) {
      this.rejected = true
      throw new RunCallLimitError()
    }
    this.outgoing++
  }
  due(): boolean {
    // A partially executed multi-fetch tool must end visibly, rather than being silently replayed.
    return !this.rejected && (this.outgoing >= RUN_CALL_LIMIT || this.now() >= this.deadline)
  }
}

type RunsOptions = {
  /** Persist a versioned ready ticket before executing it. */
  schedule: (agent: string, requestId: string) => Promise<void>
  now?: () => number
}

/** Pending input lives in pi's inbox; this class stores only active invocations in memory. */
export class Runs {
  private readonly active = new Map<string, { budget: RunBudget; work: Promise<void> }>()

  constructor(private readonly options: RunsOptions) {}

  start(agent: string, requestId: string): Promise<void> {
    return this.options.schedule(agent, requestId)
  }

  /** Called by egress and by model adapters that do not use instrumented egress. */
  count(agent: string): void { this.active.get(agent)?.budget.count() }
  countActive(): void {
    const errors: unknown[] = []
    // Runs started by one incoming event share its budget, so each distinct budget is charged once.
    for (const budget of new Set([...this.active.values()].map((a) => a.budget))) {
      try { budget.count() } catch (error) { errors.push(error) }
    }
    if (errors.length) throw errors[0]
  }

  has(agent: string): boolean { return this.active.has(agent) }

  budget(): RunBudget { return new RunBudget(this.options.now) }

  /**
   * Cloudflare meters outgoing calls per incoming event, so every run an event starts shares one budget.
   * Incoming human events may overlap; alarms execute one ticket at a time.
   */
  run(agent: string, requestId: string, invoke: (budget: RunBudget) => Promise<RunOutcome>, budget = this.budget()): Promise<void> {
    const existing = this.active.get(agent)
    if (existing) return existing.work
    const work = Promise.resolve().then(async () => {
      let outcome: RunOutcome
      try {
        outcome = await invoke(budget)
      } finally {
        this.active.delete(agent)
      }
      // A failed invocation never schedules more work. A continuation keeps its submission id.
      if (outcome === "continue") await this.options.schedule(agent, requestId)
    })
    this.active.set(agent, { budget, work })
    return work
  }
}
