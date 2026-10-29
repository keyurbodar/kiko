import type { OwnerServices } from "./services"

type AfterRunDeps = {
  services: () => OwnerServices
}

export class AfterRun {
  constructor(private readonly d: AfterRunDeps) {}

  async run(roomId: string, human: boolean): Promise<void> {
    await step("room background", () => this.d.services().room(roomId).afterRun())
    await step("memory capture", () => this.d.services().user().captureNow())
    if (human) await step("initiative", () => this.d.services().user().initiativePass())
  }
}

async function step(name: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch (error) {
    console.error(`${name} after run failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
