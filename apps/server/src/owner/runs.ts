const RUN_CALL_LIMIT = 40
export const RUN_DURATION_MS = 12 * 60_000

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
  /** Persist a versioned ready ticket; only a distinct fully awaited owner alarm may execute it. */
  schedule: (agent: string, requestId: string) => Promise<void>
  now?: () => number
}

/** Pending input lives in pi's inbox; this class stores only active invocations in memory. */
export class Runs {
  private active?: { agent: string; budget: RunBudget; work: Promise<void> }

  constructor(private readonly options: RunsOptions) {}

  start(agent: string, requestId: string): Promise<void> {
    return this.options.schedule(agent, requestId)
  }

  /** Called by egress and by model adapters that do not use instrumented egress. */
  count(agent: string): void { if (this.active?.agent === agent) this.active.budget.count() }
  countActive(): void { this.active?.budget.count() }

  /** Called for one ticket by a distinct owner alarm. No same-event fanout is allowed. */
  run(agent: string, requestId: string, invoke: (budget: RunBudget) => Promise<RunOutcome>): Promise<void> {
    const existing = this.active
    if (existing?.agent === agent) return existing.work
    if (existing) return Promise.reject(new Error("An owner run is already active"))
    const budget = new RunBudget(this.options.now)
    const work = Promise.resolve().then(async () => {
      let outcome: RunOutcome
      try {
        outcome = await invoke(budget)
      } finally {
        this.active = undefined
      }
      // A failed invocation never schedules more work. A continuation keeps its submission id.
      if (outcome === "continue") await this.options.schedule(agent, requestId)
    })
    this.active = { agent, budget, work }
    return work
  }
}
