import { DurableObject } from "cloudflare:workers"
import type { Envelope } from "@kiko/protocol"
import { measureTurn } from "../experiments/coalescing"
import { TurnExperiment } from "../experiments/turn"
import type { Env } from "../index"
import { roomStub } from "../lib/names"
import type { AgentHome } from "../room/room-do"
import { fakeSetup } from "./dev-fake"
import { buildAgent, DEV_MODEL, devModels } from "./factory"
import { AgentHost, type AgentSetup, type HostOptions } from "./host"
import { storedRows, wipeStorage } from "../lib/wipe"

declare const process: { env: { NODE_ENV?: string } }
import { Outbox, type RoomPort } from "./outbox"

const DEV_FAKE_KEY = "dev-fake"

/** One agent in one room (architecture section 4.1). The host does the work; this class is its RPC surface. */
export class AgentDO extends DurableObject<Env> {
  protected readonly hostOptions: Partial<HostOptions> = {}
  private hostInstance?: AgentHost
  private outboxInstance?: Outbox
  private experimentInstance?: TurnExperiment

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Architecture section 23: the schema migration runs before any other work on every start. The
    // inbox, the wakeups, the outbox, and the home table create or upgrade their tables here.
    void ctx.blockConcurrencyWhile(async () => {
      void this.host
      void this.outbox
      this.home()
    })
  }

  private get experiment(): TurnExperiment {
    this.experimentInstance ??= new TurnExperiment(this.ctx, this.env)
    return this.experimentInstance
  }

  protected get host(): AgentHost {
    this.hostInstance ??= new AgentHost(this.ctx, {
      progress: () => this.outbox.progress(),
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
   * room this agent belongs to and its member row; the room passes it on every delivery and the agent
   * keeps the latest. The name of this object already fixes the user, room, and slug.
   */
  receive(envelopes: Envelope[], brief: string, home?: AgentHome) {
    if (home) this.setHome(home)
    return this.host.receive(envelopes, brief)
  }

  /**
   * Called by `RoomDO` when the human presses stop (section 6.2). Discards the inputs that wait and
   * sets the alarm, which aborts the run. Like `receive`, it never waits on another object.
   */
  stop() {
    return this.host.stop()
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
    const text = JSON.stringify(home)
    if (this.home() && this.ctx.storage.sql.exec("SELECT 1 FROM agent_home WHERE home = ?", text).toArray().length) return
    this.ctx.storage.sql.exec("INSERT INTO agent_home (id, home) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET home = excluded.home", text)
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
      react: (emoji, messageId) => room().react(home.slug, emoji, messageId),
    }
  }

  /**
   * The factory builds every agent. DEV ONLY: the model and key come from the Worker's env until
   * per-user credentials (P4-02) land; the key never leaves this object. The role and lead flag are
   * the member row at the latest delivery. ASSUMPTION: they are read when the harness opens, so a
   * change reaches the prompt when the root conversation is created, not later.
   */
  protected async setup(): Promise<AgentSetup> {
    const home = this.home()
    const role = { role: home?.role ?? "", lead: home?.lead ?? true }
    if (process.env.NODE_ENV === "development" && (await this.ctx.storage.get<boolean>(DEV_FAKE_KEY))) return fakeSetup(role)
    return {
      ...buildAgent({ ...role, model: DEV_MODEL }),
      // WORKAROUND inside: the stable `x-opencode-session` header OpenCode Go requires (P0-05).
      ...devModels(this.env.OPENCODE_API_KEY, this.ctx.id.toString()),
    }
  }

  async alarm() {
    if (this.#wiped) return
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

  /**
   * Development only. Makes this agent the scripted fake of `agent/dev-fake.ts` (P1-12), which spends
   * no tokens. It takes effect when the harness next opens, so call it before the first message.
   */
  async devFake(): Promise<void> {
    if (process.env.NODE_ENV !== "development") throw new Error("not found")
    await this.ctx.storage.put(DEV_FAKE_KEY, true)
  }

  /** Development only. Stores one row, so a deletion check has agent data before agents exist (P1-06). */
  async devSeed(): Promise<void> {
    if (process.env.NODE_ENV !== "development") throw new Error("not found")
    await this.ctx.storage.put("dev-seed", Date.now())
  }
}
