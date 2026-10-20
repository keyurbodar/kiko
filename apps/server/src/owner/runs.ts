export const RUN_CALL_LIMIT = 40
export const RUN_DURATION_MS = 12 * 60_000

export type RunOutcome = "done" | "continue"
export type RunPolicy = "self-call" | "alarm"

/** One invocation's allowance; instrumentation counts actual attempts, including retries. */
export class RunBudget {
  private outgoing = 0
  readonly deadline: number

  constructor(private readonly now: () => number = Date.now) {
    this.deadline = now() + RUN_DURATION_MS
  }

  get calls(): number { return this.outgoing }
  count(): void { this.outgoing++ }
  due(): boolean { return this.outgoing >= RUN_CALL_LIMIT || this.now() >= this.deadline }
}

type RunsOptions = {
  /** Put the own-stub RPC into ctx.waitUntil and return immediately; the RPC awaits the full run. */
  dispatch: (agent: string, requestId: string) => Promise<void>
  /** Retain the stable id in PR3's clock; a new alarm dispatches the next invocation, resetting RPC ancestry. */
  schedule: (agent: string, requestId: string) => Promise<void>
  policy?: RunPolicy
  now?: () => number
}

/** Pending input lives in pi's inbox; this class stores only active invocations in memory. */
export class Runs {
  private readonly active = new Map<string, { budget: RunBudget; work: Promise<void> }>()

  constructor(private readonly options: RunsOptions) {}

  start(agent: string, requestId: string): Promise<void> {
    return this.options.policy === "alarm"
      ? this.options.schedule(agent, requestId)
      : this.options.dispatch(agent, requestId)
  }

  /** Called by egress and by model adapters that do not use instrumented egress. */
  count(agent: string): void { this.active.get(agent)?.budget.count() }

  /** The RPC entry point. Invoke must close the old Harness before returning `continue`. */
  run(agent: string, requestId: string, invoke: (budget: RunBudget) => Promise<RunOutcome>): Promise<void> {
    const existing = this.active.get(agent)
    if (existing) return existing.work
    const budget = new RunBudget(this.options.now)
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
