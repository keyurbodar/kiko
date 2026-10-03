import { DurableObject } from "cloudflare:workers"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { AuthResult } from "@earendil-works/pi-ai"
import type { Conversation, ModelRef } from "@earendil-works/pi-durable"
import type { Envelope, RoomId } from "@kiko/protocol"
import { measureTurn } from "../experiments/coalescing"
import { TurnExperiment } from "../experiments/turn"
import type { Env } from "../index"
import { roomStub, userStub } from "../lib/names"
import type { AgentHome } from "../room/room-do"
import { findProvider, type TurnMemory } from "../user/turn-context"
import { fakeSetup } from "./dev-fake"
import { imageReader } from "./extensions/files"
import { HOME_PATH, homeBackend, ObjectCache, RoomFs, roomBackend, type SoulPort, withMount, withSoul } from "../files/room-fs"
import { type MemoryPort, memoryContext } from "./extensions/memory"
import { roomWorkspacePort } from "./extensions/workspace"
import type { Approvals } from "./extensions/trust"
import type { MessagingPort } from "./extensions/messaging"
import type { RemindersPort } from "./extensions/reminders"
import type { ExecutorTool } from "../integrations/executor/tools"

const EXECUTOR_TOOLS_KEY = "executor_tools"
const EXECUTOR_TOOLS_TTL_MS = 5 * 60_000
import { buildAgent, DEFAULT_MODEL, userModels } from "./factory"
import { createAlarms } from "../lib/alarm"
import { AgentHost, type AgentSetup, HEARTBEAT_WAKEUP, type HostOptions } from "./host"
import { storedRows, wipeStorage } from "../lib/wipe"
import { instrument } from "../lib/dev-stats"

declare const process: { env: { NODE_ENV?: string } }
import { Outbox, type RoomPort } from "./outbox"

const DEV_FAKE_KEY = "dev-fake"
/** The model chosen for this agent in this room, and the one last applied to its conversation. */
const MODEL_KEY = "model"
const MODEL_APPLIED_KEY = "model:applied"

/** One agent in one room (architecture section 4.1). The host does the work; this class is its RPC surface. */
/** Memory ops that only read. In a private chat every other op is refused. */
const READ_OPS = new Set(["list", "search", "view", "history"])
const PRIVATE_REFUSAL = "this chat is private: nothing from it is saved to memory, your soul, or /home. carry on without saving."
const PRIVATE_NOTE = "this chat is private. use what you know, but save nothing from it: no memory, no soul edits, nothing in /home."

export class AgentDO extends DurableObject<Env> {
  protected readonly hostOptions: Partial<HostOptions> = {}
  private hostInstance?: AgentHost
  private outboxInstance?: Outbox
  private experimentInstance?: TurnExperiment

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    instrument(ctx, "agent")
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
      onGiveUp: async () => {
        await this.hostOptions.onGiveUp?.()
        const home = this.home()
        if (home) await roomStub(this.env.ROOM, home.userId, home.roomId).runDropped(home.slug)
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

  /**
   * Called by `RoomDO` when a socket opens on a room process that just started while a run looked
   * live. After a restart (a deploy, a crash) the run otherwise waits for its heartbeat, up to 30
   * seconds. This moves a pending heartbeat to now, so the alarm reopens the harness and resumes the
   * run at once. Like `receive`, it only stores and returns. A live process gets one extra alarm that
   * finds nothing to do. Returns false when no heartbeat is pending, that is, when no run is live.
   */
  async wake(): Promise<boolean> {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS wakeups (key TEXT PRIMARY KEY, at INTEGER NOT NULL)")
    const at = this.ctx.storage.sql.exec<{ at: number }>("SELECT at FROM wakeups WHERE key = ?", HEARTBEAT_WAKEUP).toArray()[0]?.at
    if (at === undefined) return false
    if (at > Date.now()) await createAlarms(this.ctx).setWakeup(HEARTBEAT_WAKEUP, Date.now())
    return true
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

  /** The team tools' side of the room (P6-03), bound to this agent's slug. The room sets the hop and root. */
  /** The reminder tools' port (P5-06): the user's reminders, scoped to this room, created as this agent. */
  private remindersPort(): RemindersPort | null {
    const home = this.home()
    if (!home) return null
    const user = () => userStub(this.env.USER, home.userId)
    return {
      create: (input) => user().createReminder(home.userId, { ...input, tz: input.tz ?? "UTC", roomId: home.roomId as RoomId, createdBy: home.slug }),
      list: async () => (await user().listReminders()).filter((r) => r.roomId === home.roomId),
      cancel: async (id) => {
        const out = await user().cancelReminder(id)
        return out.ok ? { ok: true } : { ok: false, error: out.error }
      },
    }
  }

  /**
   * The human's Executor tools (P7-04), listed when the harness opens and cached for five minutes,
   * so a new integration reaches the next process without a deploy. Null when Executor is not
   * connected; "unreachable" when it is but did not answer (the run starts without its tools).
   */
  private async executorTools(): Promise<ExecutorTool[] | null | "unreachable"> {
    const home = this.home()
    if (!home) return null
    const cached = await this.ctx.storage.get<{ at: number; tools: ExecutorTool[] | null }>(EXECUTOR_TOOLS_KEY)
    if (cached && Date.now() - cached.at < EXECUTOR_TOOLS_TTL_MS) return cached.tools
    try {
      const tools = await userStub(this.env.USER, home.userId).executorTools()
      await this.ctx.storage.put(EXECUTOR_TOOLS_KEY, { at: Date.now(), tools })
      return tools
    } catch {
      return cached?.tools ?? "unreachable"
    }
  }

  /** RPC from the room: a human message is in its burst window (section 7.8). Only stores. */
  async humanComing(): Promise<void> {
    this.host.humanComing()
  }

  private messagingPort(): MessagingPort | null {
    const home = this.home()
    if (!home) return null
    const room = () => roomStub(this.env.ROOM, home.userId, home.roomId)
    return { send: (input) => room().agentMessage(home.slug, input), check: (slug) => room().checkAgent(slug), spawn: (input) => room().spawnAgent(home.slug, input) }
  }

  /** This agent's soul in UserDO (section 7.10). The slug comes from the room's delivery, never the model. */
  private soulPort(): SoulPort {
    const user = () => {
      const home = this.home()
      if (!home) throw new Error("this agent has no room yet")
      return { stub: userStub(this.env.USER, home.userId), slug: home.slug }
    }
    return {
      get: () => {
        const { stub, slug } = user()
        return stub.soul(slug)
      },
      set: async (body, expectSha) => {
        if (this.home()?.private) return { ok: false, code: "invalid", message: PRIVATE_REFUSAL }
        const { stub, slug } = user()
        return stub.setSoul(slug, body, expectSha)
      },
    }
  }

  /**
   * The factory builds every agent. Every model request uses the user's own credential, which
   * `beginRun` loads once per run (architecture section 11.3). The role and lead flag are the member
   * row at the latest delivery. ASSUMPTION: they are read when the harness opens, so a change
   * reaches the prompt when the root conversation is created, not later.
   */
  protected async setup(): Promise<AgentSetup> {
    const home = this.home()
    const role = { role: home?.role ?? "", lead: home?.lead ?? true }
    const messaging = () => this.messagingPort()
    if (process.env.NODE_ENV === "development" && (await this.ctx.storage.get<boolean>(DEV_FAKE_KEY))) return fakeSetup(role, roomWorkspacePort(this.env, () => this.home()), messaging, this.approvalsPort())
    // WORKAROUND inside: the stable `x-opencode-session` header OpenCode Go requires (P0-05).
    const user = userModels((provider) => this.runAuth(provider), this.ctx.id.toString())
    const soul = this.soulPort()
    // The chat's files at /, the user's drive at /home, and this agent's soul at /me, on one byte cache.
    const cache = new ObjectCache()
    const where = () => this.home()
    const notice = (text: string) => {
      const h = this.home()
      return h ? roomStub(this.env.ROOM, h.userId, h.roomId).homeNotice(h.slug, text) : Promise.resolve()
    }
    const locked = () => (this.home()?.private ? PRIVATE_REFUSAL : null)
    const backend = withMount(roomBackend(this.env, where, cache), HOME_PATH, homeBackend(this.env, where, notice, cache, locked))
    const fs = new RoomFs(`room-files:${this.ctx.id.toString()}`, withSoul(backend, soul))
    const files = { fs, acceptsImages: imageReader(user.models) }
    const memory = this.memoryPort()
    const executor = await this.executorTools()
    return {
      ...buildAgent({ ...role, model: await this.model(), files, soul, memory, messaging, reminders: { port: () => this.remindersPort(), tz: () => this.#run?.timezone ?? "UTC" }, ...(Array.isArray(executor) && home ? { executor: { tools: executor, call: (name, args) => userStub(this.env.USER, home.userId).executorCall(name, args), gate: (callKey, tool, args) => roomStub(this.env.ROOM, home.userId, home.roomId).requestApproval(home.slug, { callKey, tool, args }) } } : {}), workspace: roomWorkspacePort(this.env, () => this.home()), approvals: this.approvalsPort() }),
      ...user,
      env: fs,
      beginRun: (batch, root) => this.beginRun(batch.requestId, root),
      // The clock goes into every input, so "in ten minutes" and "tomorrow at 9" resolve.
      inputContext: async () => {
        const tz = this.#run?.timezone ?? "UTC"
        const clock = `now: ${new Date().toISOString()} (${tz}, ${new Date().toLocaleString("en-US", { timeZone: tz, weekday: "long", hour: "numeric", minute: "2-digit" })})`
        const down = executor === "unreachable" ? "executor (the human's connected apps) is unreachable right now, so its tools are missing this run." : undefined
        const quiet = this.home()?.private ? PRIVATE_NOTE : undefined
        return [clock, down, quiet, memoryContext(this.#run?.memory ?? null)].filter(Boolean).join("\n\n")
      },
    }
  }

  /**
   * The trust gate's approvals (P7-02). The room posts a card for a tainted run's `external` call, or
   * hands back the human's accepted record. The agent can ask; it can never decide.
   */
  private approvalsPort(): Approvals {
    return async (call) => {
      const home = this.home()
      if (!home) return null
      const room = roomStub(this.env.ROOM, home.userId, home.roomId)
      return room.requestApproval(home.slug, { callKey: `${call.conversationId}:${call.callId}`, tool: call.tool, args: call.arguments })
    }
  }

  /**
   * The memory tools' port (P5-02). The profile, `now`, and `todo` come from the run's one
   * `turnContext` call. A process that resumed a run without one loads it here, once.
   */
  private memoryPort(): MemoryPort | undefined {
    const home = this.home()
    if (!home) return undefined
    return {
      author: home.slug,
      context: async () => {
        if (!this.#run) await this.loadAuth((await this.model()).provider)
        return this.#run?.memory ?? null
      },
      // A private chat leaves no trace: reads work, writes are refused (section 7.10).
      op: async (op) =>
        this.home()?.private && !READ_OPS.has(op.op) ? { ok: false, error: PRIVATE_REFUSAL } : userStub(this.env.USER, home.userId).memoryOp(op),
    }
  }

  // Per-run credentials (P4-02). The auth lives in this process's memory only, never in storage.
  #run: { provider: string; auth: AuthResult | null; memory: TurnMemory | null; timezone: string } | null = null

  /** Before a run: applies a newly chosen model, then loads the user's auth for its provider. */
  private async beginRun(requestId: string, root: Conversation): Promise<boolean> {
    const home = this.home()
    if (!home) return false
    const chosen = await this.ctx.storage.get<ModelRef>(MODEL_KEY)
    if (chosen && JSON.stringify(chosen) !== JSON.stringify(await this.ctx.storage.get(MODEL_APPLIED_KEY))) {
      await root.configure({ model: chosen }, BACKGROUND_CONTEXT)
      await this.ctx.storage.put(MODEL_APPLIED_KEY, chosen)
    }
    const model = chosen ?? DEFAULT_MODEL
    const auth = await this.loadAuth(model.provider)
    if (auth) return true
    await roomStub(this.env.ROOM, home.userId, home.roomId).noProvider(home.slug, model.provider, requestId)
    return false
  }

  /** The auth `Models` asks for on each request. A run resumed after an eviction loads it again. */
  private async runAuth(provider: string): Promise<AuthResult | undefined> {
    if (this.#run?.provider === provider) return this.#run.auth ?? undefined
    return (await this.loadAuth(provider)) ?? undefined
  }

  private async loadAuth(provider: string): Promise<AuthResult | null> {
    const home = this.home()
    const context = home ? await userStub(this.env.USER, home.userId).turnContext(provider) : null
    const memory = context ? { profile: context.profile, now: context.now, todo: context.todo } : null
    this.#run = { provider, auth: context?.auth ?? null, memory, timezone: context?.timezone ?? "UTC" }
    return this.#run.auth
  }

  /** The model this agent in this room uses. A chosen model, or the default. */
  async model(): Promise<ModelRef> {
    return (await this.ctx.storage.get<ModelRef>(MODEL_KEY)) ?? DEFAULT_MODEL
  }

  /**
   * Chooses this agent's model in this room. It applies from the next run. Returns false for a model
   * pi-ai's catalog does not have; kiko keeps no model list of its own.
   */
  async setModel(model: ModelRef): Promise<boolean> {
    if (!findProvider(model.provider)?.getModels().some((m) => m.id === model.modelId)) return false
    await this.ctx.storage.put(MODEL_KEY, { provider: model.provider, modelId: model.modelId })
    return true
  }

  async alarm() {
    if (this.#wiped) return
    // The experiment objects (`experiment:turn:*`) keep their own heartbeat key. Real agents never have it.
    const experiment = this.ctx.storage.sql.exec("SELECT 1 FROM wakeups WHERE key = 'experiment-heartbeat'").toArray().length > 0
    if (experiment) return this.experiment.alarm()
    await this.host.alarm()
  }

  experimentTurn(requestId: string, heartbeat: boolean, userId: string) {
    return this.experiment.turn(requestId, heartbeat, userId)
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

  /** Development only. The agent's subagent conversations, so `verify subagent` can count them. */
  async devChildren(): Promise<{ id: string; taskId: string }[]> {
    if (process.env.NODE_ENV !== "development") throw new Error("not found")
    return this.host.children()
  }

  /** Development only. Stores one row, so a deletion check has agent data before agents exist (P1-06). */
  async devSeed(): Promise<void> {
    if (process.env.NODE_ENV !== "development") throw new Error("not found")
    await this.ctx.storage.put("dev-seed", Date.now())
  }
}
