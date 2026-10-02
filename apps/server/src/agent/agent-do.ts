import { DurableObject } from "cloudflare:workers"
import { TurnExperiment } from "../experiments/turn"
import type { Env } from "../index"

export class AgentDO extends DurableObject<Env> {
  private readonly experiment = new TurnExperiment(this.ctx, this.env)

  experimentTurn(requestId: string) {
    return this.experiment.turn(requestId)
  }

  experimentStatus() {
    return this.experiment.status()
  }

  async alarm() {
    await this.experiment.alarm()
  }
}
