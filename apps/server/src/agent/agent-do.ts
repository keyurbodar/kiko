import { DurableObject } from "cloudflare:workers"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { AuthResult } from "@earendil-works/pi-ai"
import type { Conversation, Harness, ModelRef } from "@earendil-works/pi-durable"
import type { Envelope, RoomId } from "@kiko/protocol"
import { measureTurn } from "../experiments/coalescing"
import { TurnExperiment } from "../experiments/turn"
import type { Env } from "../index"
import { AnswerWaiters } from "./answers"
import { roomStub, userStub } from "../lib/names"
import type { AgentHome } from "../room/room-do"
import { findProvider } from "../user/turn-context"
import { fakeSetup } from "./dev-fake"
import { imageReader } from "./extensions/files"
import type { ChiefPort } from "./extensions/chief"
import { CHIEF } from "../room/chief"
import { HOME_PATH, homeBackend, ObjectCache, RoomFs, roomBackend, type SoulPort, withMount, withSoul } from "../files/room-fs"
import { type MemoryPort, memoryBlock, memoryDelta } from "./extensions/memory"
import { roomWorkspacePort } from "./extensions/workspace"
import type { Approvals } from "./extensions/trust"
import type { MessagingPort } from "./extensions/messaging"
import type { RemindersPort } from "./extensions/reminders"
import type { ExecutorTool } from "../integrations/executor/tools"

const EXECUTOR_TOOLS_KEY = "executor_tools"
const EXECUTOR_TOOLS_TTL_MS = 5 * 60_000
import { buildAgent, DEFAULT_MODEL, type UserExtensions, userModels } from "./factory"
import type { GuestResponse, Installed, ScriptPorts } from "./script/compile"
import { hasScriptWasm, scriptWasm } from "./script/wasm"
import { checkExtension } from "./script/check"
import type { BuilderPorts } from "./extensions/builder"
import type { ExtensionBundle, ExtensionInfo, ExtensionResult, ExtensionStateScope } from "@kiko/protocol"
import { createAlarms } from "../lib/alarm"
import { AgentHost, type AgentSetup, AUTO_RUN_BUDGET_MS, HEARTBEAT_WAKEUP, type HostOptions } from "./host"
import type { Batch } from "./inbox"
import { storedRows, wipeStorage } from "../lib/wipe"
import { instrument } from "../lib/dev-stats"

declare const process: { env: { NODE_ENV?: string } }
import { Outbox, type RoomPort } from "./outbox"

const DEV_FAKE_KEY = "dev-fake"
const DEV_CLASSIC_KEY = "dev-classic"
/** Development only: the budget `devBudget` sets for runs no human started. */
const DEV_BUDGET_KEY = "dev:auto-budget-ms"
/** The room's turn count when this agent last read it: where the next run's delta starts (section 13). */
const MEMORY_POS_KEY = "memory:pos"
/** Missed more turns than this, and the run starts over from the whole block instead of a long delta. */
const MAX_DELTA_TURNS = 32
const USAGE_CARRIED_KEY = "usage:carried"
/** One outside request as it crosses to `egress`. */
type EgressRequest = { url: string; method: string; headers: [string, string][]; body: ArrayBuffer | null }
/** Extension bundles this agent fetched, by content hash (section 24.5). */
const BUNDLE_PREFIX = "ext-bundle:"
/** The model chosen for this agent in this room, and the one last applied to its conversation. */
const MODEL_KEY = "model"
const MODEL_APPLIED_KEY = "model:applied"

/** One agent in one room (architecture section 4.1). The host does the work; this class is its RPC surface. */
const PRIVATE_REFUSAL = "this chat is private: nothing from it is saved to memory, your soul, or /home. carry on without saving."
const PRIVATE_NOTE = "this chat is private. use what you know, but save nothing from it: no memory, no soul edits, nothing in /home."

export class AgentDO extends DurableObject<Env> {
  protected readonly hostOptions: Partial<HostOptions> = {}
  private hostInstance?: AgentHost
  private outboxInstance?: Outbox
  private experimentInstance?: TurnExperiment
  private readonly answers = new AnswerWaiters()

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
      // Extension VMs live for a run. Wasm memory never shrinks, and the isolate's 128 MB is shared.
      onIdle: () => this.#userExtensions?.release(),
      ...this.hostOptions,
      setup: () => this.setup(),
      onOpen: async (opened) => {
        await this.hostOptions.onOpen?.(opened)
        // Before resume, so the outbox sees a resumed run from its first event.
        await this.outbox.attach(opened.harness, opened.root.id)
      },
      ...(process.env.NODE_ENV === "development" ? { autoBudgetMs: async () => (await this.ctx.storage.get<number>(DEV_BUDGET_KEY)) ?? AUTO_RUN_BUDGET_MS } : {}),
      onTimeout: async () => {
        const home = this.home()
        if (home) await roomStub(this.env.ROOM, home.userId, home.roomId).runTimedOut(home.slug)
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
      () => {
        const epoch = this.host.epoch()
        return `${this.home()?.slug ?? "agent"}${epoch ? `~${epoch}` : ""}`
      },
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
    if (envelopes.some((e) => e.from.kind === "human")) this.answers.interrupt()
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
      post: (runId, attempt, index, block, tainted) => room().post(home.slug, runId, attempt, index, block, tainted),
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
    const room = () => roomStub(this.env.ROOM, home.userId, home.roomId)
    const tz = () => this.#run?.timezone ?? "UTC"
    // An agent reaches only the reminders and routines of its own chat, whatever id it passes.
    const mine = async (id: string) => (await user().listReminders()).some((r) => r.id === id && r.roomId === home.roomId)
    const notHere = { ok: false as const, error: "no such reminder in this chat" }
    return {
      create: (input) => user().createReminder(home.userId, { ...input, tz: input.tz ?? "UTC", roomId: home.roomId as RoomId, createdBy: home.slug }),
      list: async () => (await user().listReminders()).filter((r) => r.roomId === home.roomId),
      cancel: async (id) => {
        if (!(await mine(id))) return notHere
        const out = await user().cancelReminder(id)
        return out.ok ? { ok: true } : { ok: false, error: out.error }
      },
      createRoutine: (input) =>
        user().createRoutine(home.userId, { ...input, target: input.target ?? home.slug, tz: tz(), roomId: home.roomId as RoomId, createdBy: home.slug }),
      updateRoutine: async (id, patch) => ((await mine(id)) ? user().updateRoutine(id, patch) : notHere),
      runRoutine: async (id) => ((await mine(id)) ? user().runRoutine(id) : null),
      runs: async (id) => ((await mine(id)) ? user().routineRuns(id) : []),
      ask: (callKey, tool, args, summary) => room().requestApproval(home.slug, { callKey, tool, args, summary, ttlMs: 86_400_000 }),
      origin: () => user().publicOrigin(),
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
    this.answers.interrupt()
  }

  /** RPC from the room: a teammate answered this agent's open ask `id` (section 7.5). Only hands it over. */
  async askAnswered(id: string, answer: string): Promise<void> {
    this.answers.answer(id, answer)
  }

  private messagingPort(): MessagingPort | null {
    const home = this.home()
    if (!home) return null
    const room = () => roomStub(this.env.ROOM, home.userId, home.roomId)
    return {
      send: (input) => room().agentMessage(home.slug, input),
      ask: (input) => room().ask(home.slug, input),
      askState: (id) => room().askState(id),
      waitAnswer: (id, ms) => this.answers.wait(id, ms),
      closeAsk: (id) => room().closeAsk(id),
      humanWaiting: () => this.host.humanWaiting(),
      spawn: (input) => room().spawnAgent(home.slug, input),
      team: () => room().teamNow(),
    }
  }

  /** One line for the team board: what this agent's current tool call is about (section 7.12). */
  private async report(doing: string): Promise<void> {
    const home = this.home()
    if (home) await roomStub(this.env.ROOM, home.userId, home.roomId).reportDoing(home.slug, doing)
  }

  /** kiko's making of agents and groups (section 7.11). Every other agent gets none. */
  private chiefPort(): ChiefPort | undefined {
    const home = this.home()
    if (home?.slug !== CHIEF) return undefined
    const room = () => roomStub(this.env.ROOM, home.userId, home.roomId)
    return {
      agents: () => userStub(this.env.USER, home.userId).listAgents(),
      propose: (input) => room().propose(home.slug, input),
      create: (id) => room().createProposal(home.slug, id),
      overview: () => userStub(this.env.USER, home.userId).overview(),
    }
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
    if (process.env.NODE_ENV === "development" && (await this.ctx.storage.get<boolean>(DEV_FAKE_KEY))) {
      const fake = fakeSetup(role, roomWorkspacePort(this.env, () => this.home()), messaging, this.approvalsPort(), this.scriptPorts(), {
        authority: () => this.host.authority(),
        reminders: { port: () => this.remindersPort(), tz: () => "UTC" },
        chief: this.chiefPort(),
      })
      return {
        ...fake,
        beginRun: async (_batch, root) => {
          await this.syncExtensions(fake.extensions, root)
          return true
        },
        // The fake reads memory like a real agent, so the suites prove the <memory> block, not a stand-in.
        inputMemory: (batch, fresh) => this.inputMemory(batch, fresh, ""),
        beforeCompact: (harness) => this.carryUsage(harness),
      }
    }
    // WORKAROUND inside: the stable `x-opencode-session` header OpenCode Go requires (P0-05).
    const egress = this.egressFetch()
    const user = userModels((provider) => this.runAuth(provider), this.ctx.id.toString(), egress)
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
    const scripts = this.scriptPorts()
    const built = buildAgent({ ...role, model: await this.model(), files, soul, chief: this.chiefPort(), presence: (doing) => this.report(doing), memory, messaging, reminders: { port: () => this.remindersPort(), tz: () => this.#run?.timezone ?? "UTC" }, ...(Array.isArray(executor) && home ? { executor: { tools: executor, call: (name, args) => userStub(this.env.USER, home.userId).executorCall(name, args), gate: (callKey, tool, args, card) => roomStub(this.env.ROOM, home.userId, home.roomId).requestApproval(home.slug, { callKey, tool, args, ...card }) } } : {}), workspace: roomWorkspacePort(this.env, () => this.home()), approvals: this.approvalsPort(), authority: () => this.host.authority(), ...(scripts ? { scripts, builder: this.builderPorts(fs) } : {}), ...(process.env.NODE_ENV === "development" ? {} : { egress: (url: string, init: RequestInit) => egress(url, init) }) })
    return {
      ...built,
      ...user,
      env: fs,
      beginRun: async (batch, root) => {
        await this.syncExtensions(built.extensions, root)
        return this.beginRun(batch.requestId, root)
      },
      // The clock goes into every input, so "in ten minutes" and "tomorrow at 9" resolve.
      inputContext: async () => {
        const tz = this.#run?.timezone ?? "UTC"
        const clock = `now: ${new Date().toISOString()} (${tz}, ${new Date().toLocaleString("en-US", { timeZone: tz, weekday: "long", hour: "numeric", minute: "2-digit" })})`
        const down = executor === "unreachable" ? "executor (the human's connected apps) is unreachable right now, so its tools are missing this run." : undefined
        const quiet = this.home()?.private ? PRIVATE_NOTE : undefined
        const extensions = this.#extensionsNote ? `the human's installed extensions, live this run: ${this.#extensionsNote}.` : undefined
        return [clock, down, quiet, extensions].filter(Boolean).join("\n\n")
      },
      // Development only: `classic` keeps the old transcript (no reset, no memory block), so `verify
      // token-cost` can measure both designs on the same model.
      ...(process.env.NODE_ENV === "development" && (await this.ctx.storage.get<boolean>(DEV_CLASSIC_KEY)) ? {} : { inputMemory: (batch: Batch, fresh: boolean) => this.inputMemory(batch, fresh, this.#run?.life ?? "") }),
      beforeCompact: (harness) => this.carryUsage(harness),
    }
  }

  /**
   * Section 13. The <memory> block a new run opens with: the user's life log, from the run's one
   * `turnContext` call, and this chat as of now, without the messages the batch itself delivers.
   */
  private async inputMemory(batch: Batch, fresh: boolean, life: string): Promise<{ text?: string; fresh: boolean }> {
    const home = this.home()
    if (!home) return { fresh }
    const room = roomStub(this.env.ROOM, home.userId, home.roomId)
    const seqs = batch.envelopes.map((e) => e.seq)
    const seen = await this.ctx.storage.get<number>(MEMORY_POS_KEY)
    // Going on: only the turns since this agent's last run, without its own, which its transcript holds.
    if (!fresh && seen !== undefined) {
      const delta = await room.memorySince(home.slug, seen, seqs)
      if (delta.count - seen <= MAX_DELTA_TURNS) {
        await this.ctx.storage.put(MEMORY_POS_KEY, delta.count)
        return { fresh: false, ...(delta.text ? { text: memoryDelta(delta.text) } : {}) }
      }
    }
    // Starting over: the whole block, as OptMem's wake.
    const view = await room.memoryView(seqs)
    await this.ctx.storage.put(MEMORY_POS_KEY, view.count)
    return { fresh: true, text: memoryBlock(life, view.text) }
  }

  /** Keeps the token count across a drop of pi-durable's tables, so `devUsage` still adds up. */
  private async carryUsage(harness: Harness): Promise<void> {
    const now = await this.usageOf(harness)
    const carried = (await this.ctx.storage.get<typeof now>(USAGE_CARRIED_KEY)) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    await this.ctx.storage.put(USAGE_CARRIED_KEY, { input: carried.input + now.input, output: carried.output + now.output, cacheRead: carried.cacheRead + now.cacheRead, cacheWrite: carried.cacheWrite + now.cacheWrite })
  }

  private async usageOf(harness: Harness): Promise<{ input: number; output: number; cacheRead: number; cacheWrite: number }> {
    const usage = await harness.usage(BACKGROUND_CONTEXT)
    const sum = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    for (const u of Object.values(usage.models) as unknown as (typeof sum)[]) {
      sum.input += u.input
      sum.output += u.output
      sum.cacheRead += u.cacheRead
      sum.cacheWrite += u.cacheWrite
    }
    return sum
  }

  /**
   * Architecture section 24.5. Before each run: read the versions this agent runs, fetch the
   * bundles it has not seen, install them in the registry, and give the root conversation the new
   * selection when it changed. A failure keeps what the agent had: an extension never stops a run.
   */
  private async syncExtensions(extensions: UserExtensions, root: Conversation): Promise<void> {
    this.#userExtensions = extensions
    const home = this.home()
    if (!home) return
    const user = userStub(this.env.USER, home.userId)
    try {
      const list = await user.extensionsFor(home.slug)
      const installed: Installed[] = []
      const missing: string[] = []
      for (const item of list) {
        const stored = await this.ctx.storage.get<Installed>(`${BUNDLE_PREFIX}${item.hash}`)
        if (stored) installed.push(stored)
        else missing.push(item.hash)
      }
      if (missing.length) {
        for (const b of (await user.extensionBundles(missing)) as unknown as Installed[]) {
          await this.ctx.storage.put(`${BUNDLE_PREFIX}${b.hash}`, b)
          installed.push(b)
        }
      }
      // Bundles no longer installed are dropped from storage.
      const keep = new Set(list.map((i) => `${BUNDLE_PREFIX}${i.hash}`))
      const stale = [...(await this.ctx.storage.list({ prefix: BUNDLE_PREFIX })).keys()].filter((k) => !keep.has(k))
      if (stale.length) await this.ctx.storage.delete(stale)
      const problems = extensions.sync(installed)
      for (const p of problems) void user.extensionError(p.name, p.hash, p.error).catch(() => {})
      // The run's context names what is installed, so the agent knows a tool it proposed is live now.
      const broken = new Set(problems.map((p) => p.name))
      this.#extensionsNote = installed
        .filter((i) => !broken.has(i.name))
        .map((i) => `${i.name} ${i.bundle.manifest.version}${Object.keys(i.bundle.manifest.tools ?? {}).length ? ` (tools: ${Object.keys(i.bundle.manifest.tools ?? {}).join(", ")})` : ""}`)
        .join("; ")
      const want = extensions.selection()
      const have = (await root.agent(BACKGROUND_CONTEXT)).extensions.map((e) => e.name)
      if (want.map((e) => e.name).join("\n") !== have.join("\n")) await root.configure({ extensions: want }, BACKGROUND_CONTEXT)
    } catch (error) {
      console.error(`extensions not synced: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Architecture section 17.3. One outside request, made in its own invocation. On the Free plan an
   * invocation may make 50 subrequests, and a run's work all belongs to the invocation that started
   * it, so a long run would fail partway. A call through this object's own stub is a new incoming
   * request with a fresh budget, and RPC calls do not count against the 50 (measured 2026-10-04).
   * Only this object calls it, through `egressFetch`.
   */
  async egress(request: EgressRequest): Promise<Response> {
    if (new URL(request.url).protocol !== "https:") throw new Error("egress is https only")
    return fetch(request.url, { method: request.method, headers: request.headers, ...(request.body ? { body: request.body } : {}) })
  }

  /**
   * A `fetch` that goes out through `egress`. An abort signal cannot cross RPC, so it is applied
   * here: before the call it throws, and after it the body stream is cut.
   */
  private egressFetch(): typeof fetch {
    const self = () => this.env.AGENT.get(this.ctx.id) as unknown as { egress(request: EgressRequest): Promise<Response> }
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
      signal?.throwIfAborted()
      // The request crosses as plain data: a request body streamed over RPC can be cut off before the
      // other side reads it. Model requests are small JSON, so reading it whole costs nothing.
      const request = new Request(input as RequestInfo, { ...init, signal: null })
      const body = request.body ? await request.arrayBuffer() : null
      const response = await self().egress({ url: request.url, method: request.method, headers: [...request.headers], body })
      if (!signal || !response.body) return response
      const { readable, writable } = new TransformStream()
      response.body.pipeTo(writable, { signal }).catch(() => {})
      return new Response(readable, { status: response.status, statusText: response.statusText, headers: response.headers })
    }) as typeof fetch
  }

  /** This process's user extensions, so going idle can free their VMs. */
  #userExtensions?: UserExtensions

  /** The installed extensions, as one line for the run's context. Empty when there are none. */
  #extensionsNote = ""

  /** What a running extension script reaches, bound to this agent's user, room, and slug. Null without the QuickJS binary. */
  private scriptPorts(): ScriptPorts | undefined {
    if (!hasScriptWasm()) return undefined
    const where = () => {
      const home = this.home()
      if (!home) throw new Error("this agent has no room yet")
      return home
    }
    const scope = (kind: ExtensionStateScope) => {
      const home = where()
      return kind === "user" ? "user" : kind === "room" ? `room:${home.roomId}` : `agent:${home.roomId}:${home.slug}`
    }
    return {
      wasm: scriptWasm,
      state: async (name, kind, op, key, value) => {
        const home = where()
        // A private chat leaves no trace across chats (section 7.10): user-wide state only reads.
        if (home.private && kind === "user" && (op === "set" || op === "delete")) throw new Error(PRIVATE_REFUSAL)
        return userStub(this.env.USER, home.userId).extensionState(name, scope(kind), op, key, value)
      },
      fetch: async (name, request) => (await userStub(this.env.USER, where().userId).extensionFetch(name, request)) as GuestResponse,
      env: () => {
        const home = this.home()
        return { agent: home?.slug ?? "agent", ...(home ? { room: home.roomId } : {}), timezone: this.#run?.timezone ?? "UTC" }
      },
      report: (name, hash, error) => {
        const home = this.home()
        if (home) void userStub(this.env.USER, home.userId).extensionError(name, hash, error).catch(() => {})
      },
    }
  }

  /** `extension_check` and `extension_propose`, on this chat's files. */
  private builderPorts(fs: RoomFs): BuilderPorts {
    const where = () => {
      const home = this.home()
      if (!home) throw new Error("this agent has no room yet")
      return home
    }
    return {
      fs,
      check: (bundle, tools) => checkExtension(bundle, scriptWasm(), tools),
      propose: async (bundle, tainted) => {
        const home = where()
        const out = (await userStub(this.env.USER, home.userId).proposeExtension({ bundle, by: home.slug, room: home.roomId, tainted })) as ExtensionResult
        if (out.ok && out.proposal) await roomStub(this.env.ROOM, home.userId, home.roomId).homeNotice(home.slug, `proposed the ${out.proposal.name} extension. review it in settings → extensions`)
        return out
      },
      list: async () => (await userStub(this.env.USER, where().userId).extensionList()) as unknown as ExtensionInfo[],
      source: async (name) => (await userStub(this.env.USER, where().userId).extensionSource(name)) as unknown as ExtensionBundle | null,
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
   * The memory tools' port (section 13). Life lines live in `UserDO`, this chat in `RoomDO`. A private
   * chat reads both and writes nothing (section 7.10).
   */
  private memoryPort(): MemoryPort | undefined {
    const home = this.home()
    if (!home) return undefined
    const user = () => userStub(this.env.USER, home.userId)
    const room = () => roomStub(this.env.ROOM, home.userId, home.roomId)
    return {
      note: async (text, tainted) => (this.home()?.private ? { ok: false, error: PRIVATE_REFUSAL } : user().lifeNote(home.slug, text, tainted)),
      recall: async (query) => {
        const [life, chat] = await Promise.all([user().lifeRecall(query), room().memoryRecall(query)])
        return [life.length ? `life:\n${life.join("\n")}` : "", chat.length ? `chat:\n${chat.join("\n")}` : ""].filter(Boolean).join("\n\n")
      },
      zoom: async (id) => {
        const m = /^(life|chat|room):(.+)$/.exec(id)
        if (!m) return null
        return m[1] === "life" ? user().lifeZoom(m[2]!) : room().memoryZoom(m[2]!)
      },
    }
  }

  // Per-run credentials (P4-02). The auth lives in this process's memory only, never in storage.
  #run: { provider: string; auth: AuthResult | null; life: string; timezone: string } | null = null

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
    this.#run = { provider, auth: context?.auth ?? null, life: context?.life ?? "", timezone: context?.timezone ?? "UTC" }
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
  /** Development only. Makes this agent keep the old transcript, for `verify token-cost`. Call before the first message. */
  async devClassic(): Promise<void> {
    if (process.env.NODE_ENV !== "development") throw new Error("not found")
    await this.ctx.storage.put(DEV_CLASSIC_KEY, true)
  }

  /** Development only. The tokens this agent's model requests spent, summed over every model. */
  async devUsage(): Promise<{ input: number; output: number; cacheRead: number; cacheWrite: number }> {
    if (process.env.NODE_ENV !== "development") throw new Error("not found")
    if (!this.home()) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    const { harness } = await this.host.open()
    const now = await this.usageOf(harness)
    const carried = (await this.ctx.storage.get<typeof now>(USAGE_CARRIED_KEY)) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    return { input: carried.input + now.input, output: carried.output + now.output, cacheRead: carried.cacheRead + now.cacheRead, cacheWrite: carried.cacheWrite + now.cacheWrite }
  }

  /** Development only. Each run's requests: the tools it called and how long its text was, for `verify token-cost`. */
  async devTrace(): Promise<{ kind: string; tool?: string; chars: number; text?: string }[]> {
    if (process.env.NODE_ENV !== "development") throw new Error("not found")
    if (!this.home()) return []
    const { root } = await this.host.open()
    const view = await root.context(BACKGROUND_CONTEXT)
    return view.entries.map((e) => {
      const m = e.model?.[0] as { content?: string | { type: string; text?: string; name?: string; thinking?: string }[] } | undefined
      const parts = typeof m?.content === "string" ? [{ type: "text", text: m.content }] : (m?.content ?? [])
      const tool = parts.find((p) => p.type === "toolCall")?.name
      const text = parts.map((p) => p.text ?? "").join("").slice(0, 300)
      return { kind: e.kind, ...(tool ? { tool } : {}), chars: parts.reduce((n, p) => n + (p.text?.length ?? 0) + (p.thinking?.length ?? 0), 0), ...(text ? { text } : {}) }
    })
  }

  /** Development only. A shorter budget for runs nobody asked for, so `verify routines` sees a timeout (section 25.2). */
  async devBudget(ms: number): Promise<void> {
    if (process.env.NODE_ENV !== "development") throw new Error("not found")
    await this.ctx.storage.put(DEV_BUDGET_KEY, ms)
  }

  async devFake(): Promise<void> {
    if (process.env.NODE_ENV !== "development") throw new Error("not found")
    await this.ctx.storage.put(DEV_FAKE_KEY, true)
  }

  /** Development only. The agent's subagent conversations, so `verify subagent` can count them. */
  async devChildren(): Promise<{ id: string; taskId: string }[]> {
    if (process.env.NODE_ENV !== "development") throw new Error("not found")
    // Opening the harness builds the agent once per process; built before its first delivery, it would
    // have no home, so no memory tools and no role. A dev route never does that.
    if (!this.home()) return []
    return this.host.children()
  }

  /** Development only. Stores one row, so a deletion check has agent data before agents exist (P1-06). */
  async devSeed(): Promise<void> {
    if (process.env.NODE_ENV !== "development") throw new Error("not found")
    await this.ctx.storage.put("dev-seed", Date.now())
  }
}
