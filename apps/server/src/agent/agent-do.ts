import { DurableObject } from "cloudflare:workers"
import { TurnExperiment } from "../experiments/turn"
import { measureTurn } from "../experiments/coalescing"
import type { Env } from "../index"
import { storedRows, wipeStorage } from "../lib/wipe"

declare const process: { env: { NODE_ENV?: string } }

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
    if (this.#wiped) return
    await this.experiment.alarm()
  }

  // Account deletion (P9-02). The room's deletion job calls these.
  #wiped = false

  /** Deletes all of the agent's storage. Returns the rows that held data, 0 on a repeat. */
  async deleteAll(): Promise<number> {
    if (this.#wiped) return 0
    const rows = await wipeStorage(this.ctx)
    this.#wiped = true
    return rows
  }

  async storedRows(): Promise<number> {
    return this.#wiped ? 0 : storedRows(this.ctx.storage)
  }

  /** Development only. Stores one row, so a deletion check has agent data before agents exist (P1-06). */
  async devSeed(): Promise<void> {
    if (process.env.NODE_ENV !== "development") throw new Error("not found")
    await this.ctx.storage.put("dev-seed", Date.now())
  }
}
