import type { OwnerServices } from "./services"

type AfterRunDeps = {
  services: () => OwnerServices
}

/**
 * The background work that rides on a human run. It runs once, in the run's own invocation, after the reply
 * is sent, and a step that fails waits for the next human run instead of scheduling itself again.
 *
 * The room owns its own after-run work (memory summaries, then archive), so this only forwards to it and
 * then runs the per-owner steps.
 */
export class AfterRun {
  constructor(private readonly d: AfterRunDeps) {}

  async run(roomId: string, _slug: string): Promise<void> {
    await step("room background", () => this.d.services().room(roomId).afterRun())
    await step("memory capture", () => this.d.services().user().captureNow())
    await step("initiative", () => this.d.services().user().initiativePass())
  }
}

async function step(name: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch (error) {
    console.error(`${name} after run failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
