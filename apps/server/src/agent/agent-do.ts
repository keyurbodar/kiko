import { DurableObject } from "cloudflare:workers"
import type { Envelope } from "@kiko/protocol"
import { measureTurn } from "../experiments/coalescing"
import { TurnExperiment } from "../experiments/turn"
import type { Env } from "../index"
import { roomStub } from "../lib/names"
import type { AgentHome } from "../room/room-do"
import { buildAgent, DEV_MODEL, devModels } from "./factory"
import { AgentHost, type AgentSetup, type HostOptions } from "./host"
import { Outbox, type RoomPort } from "./outbox"

/** One agent in one room (architecture section 4.1). The host does the work; this class is its RPC surface. */
export class AgentDO extends DurableObject<Env> {
  protected readonly hostOptions: Partial<HostOptions> = {}
  private hostInstance?: AgentHost
  private outboxInstance?: Outbox
  private readonly experiment = new TurnExperiment(this.ctx, this.env)

  protected get host(): AgentHost {
    this.hostInstance ??= new AgentHost(this.ctx, {
      ...this.hostOptions,
      setup: () => this.setup(),
      onOpen: async (opened) => {
        await this.hostOptions.onOpen?.(opened)
        // Before resume, so the outbox sees a resumed run from its first event.
        await this.outbox.attach(opened.harness, opened.root.id)
      },
    })
    return this.hostInstance
  }

  protected get outbox(): Outbox {
    this.outboxInstance ??= new Outbox(
      this.ctx.storage,
      () => this.roomPort(),
      () => this.home()?.slug ?? "agent",
    )
    return this.outboxInstance
  }

  /**
   * Called by `RoomDO` only. Stores the envelopes and returns. It never waits on a model or on
   * another Durable Object, so two agents that message each other cannot deadlock. `home` says which
   * room this agent belongs to; the room passes it on every delivery and the agent keeps the first.
   */
  receive(envelopes: Envelope[], brief: string, home?: AgentHome) {
    if (home) this.setHome(home)
    return this.host.receive(envelopes, brief)
  }

  /** Inbox counts and live work, for tests and the CLI. Opens nothing. */
  status() {
    return this.host.status()
  }

  /** The room that delivered to this agent. Only `RoomDO` sets it, from its own name. */
  protected home(): AgentHome | null {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS agent_home (id INTEGER PRIMARY KEY CHECK (id = 1), home TEXT NOT NULL)")
    const row = this.ctx.storage.sql.exec<{ home: string }>("SELECT home FROM agent_home WHERE id = 1").toArray()[0]
    return row ? (JSON.parse(row.home) as AgentHome) : null
  }

  private setHome(home: AgentHome): void {
    if (this.home()) return
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO agent_home (id, home) VALUES (1, ?)", JSON.stringify(home))
  }

  /** The room's RPC, bound to this agent's slug. Tests override it. */
  protected roomPort(): RoomPort | null {
    const home = this.home()
    if (!home) return null
    const room = () => roomStub(this.env.ROOM, home.userId, home.roomId)
    return {
      post: (runId, attempt, index, block) => room().post(home.slug, runId, attempt, index, block),
      draft: (runId, index, text) => room().draft(home.slug, runId, index, text),
      status: (state) => room().setStatus(home.slug, state),
      endRun: (runId) => room().endRun(home.slug, runId),
    }
  }

  /**
   * The factory builds every agent. DEV ONLY: the model and key come from the Worker's env until
   * per-user credentials (P4-02) land; the key never leaves this object. ASSUMPTION: every agent is
   * a lead with the default role until the room passes membership (P6).
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
