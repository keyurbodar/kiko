import { DurableObject } from "cloudflare:workers"
import { TurnExperiment } from "../experiments/turn"
import { measureTurn } from "../experiments/coalescing"
import type { Env } from "../index"

export class AgentDO extends DurableObject<Env> {
  private readonly experiment = new TurnExperiment(this.ctx, this.env)

  experimentTurn(requestId: string, heartbeat = true) {
    return this.experiment.turn(requestId, heartbeat)
  }

  experimentStatus() {
    return this.experiment.status()
  }

  experimentCoalescing(coalesce: boolean, streamMs: number) {
    return measureTurn(this.ctx.storage, coalesce, streamMs)
  }

  async alarm() {
    await this.experiment.alarm()
  }
}
