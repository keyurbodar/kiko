import { DurableObject } from "cloudflare:workers"
import { createModels } from "@earendil-works/pi-ai/models"
import { opencodeGoProvider } from "@earendil-works/pi-ai/providers/opencode-go"
import { createRegistry } from "@earendil-works/pi-durable"
import type { Envelope } from "@kiko/protocol"
import { measureTurn } from "../experiments/coalescing"
import { TurnExperiment } from "../experiments/turn"
import type { Env } from "../index"
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
   * DEV ONLY until the agent factory (P1-10) and per-user credentials (P4-02) land. The key comes from
   * the Worker's env and never leaves this object.
   */
  protected setup(): AgentSetup {
    const models = createModels({
      authContext: {
        env: async (name) => (name === "OPENCODE_API_KEY" ? this.env.OPENCODE_API_KEY || undefined : undefined),
        fileExists: async () => false,
      },
    })
    models.setProvider(opencodeGoProvider())
    return {
      models,
      registry: createRegistry(),
      agent: { model: { provider: "opencode-go", modelId: "deepseek-v4.1-flash" } },
      // WORKAROUND: OpenCode Go answers 400 MissingSessionID without this header (P0-05).
      settings: { stream: { headers: { "x-opencode-session": this.ctx.id.toString() } } },
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
