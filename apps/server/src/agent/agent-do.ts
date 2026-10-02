import { DurableObject } from "cloudflare:workers"
import type { Envelope } from "@kiko/protocol"
import { measureTurn } from "../experiments/coalescing"
import { TurnExperiment } from "../experiments/turn"
import type { Env } from "../index"
import { buildAgent, DEV_MODEL, devModels } from "./factory"
import { AgentHost, type AgentSetup, type HostOptions } from "./host"

/** One agent in one room (architecture section 4.1). The host does the work; this class is its RPC surface. */
export class AgentDO extends DurableObject<Env> {
  protected readonly hostOptions: Partial<HostOptions> = {}
  private hostInstance?: AgentHost
  private readonly experiment = new TurnExperiment(this.ctx, this.env)

  protected get host(): AgentHost {
    this.hostInstance ??= new AgentHost(this.ctx, { ...this.hostOptions, setup: () => this.setup() })
    return this.hostInstance
  }

  /**
   * Called by `RoomDO` only. Stores the envelopes and returns. It never waits on a model or on
   * another Durable Object, so two agents that message each other cannot deadlock.
   */
  receive(envelopes: Envelope[], brief: string) {
    return this.host.receive(envelopes, brief)
  }

  /** Inbox counts and live work, for tests and the CLI. Opens nothing. */
  status() {
    return this.host.status()
  }

  /**
   * The factory builds every agent. DEV ONLY: the model and key come from the Worker's env until
   * per-user credentials (P4-02) land; the key never leaves this object. ASSUMPTION: every agent is
   * a lead with the default role until the room passes membership (P1-11).
   */
  protected setup(): AgentSetup {
    return {
      ...buildAgent({ role: "", lead: true, model: DEV_MODEL }),
      // WORKAROUND inside: the stable `x-opencode-session` header OpenCode Go requires (P0-05).
      ...devModels(this.env.OPENCODE_API_KEY, this.ctx.id.toString()),
    }
  }

  async alarm() {
    // The experiment objects (`experiment:turn:*`) keep their own heartbeat key. Real agents never have it.
    const experiment = this.ctx.storage.sql.exec("SELECT 1 FROM wakeups WHERE key = 'experiment-heartbeat'").toArray().length > 0
    if (experiment) return this.experiment.alarm()
    await this.host.alarm()
  }

  experimentTurn(requestId: string, heartbeat = true) {
    return this.experiment.turn(requestId, heartbeat)
  }

  experimentStatus() {
    return this.experiment.status()
  }

  experimentCoalescing(coalesce: boolean, streamMs: number) {
    return measureTurn(this.ctx.storage, coalesce, streamMs)
  }
}
