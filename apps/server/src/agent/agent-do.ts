import { DurableObject } from "cloudflare:workers"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { AuthResult } from "@earendil-works/pi-ai"
import type { Conversation, Harness, ModelRef, SubmissionId } from "@earendil-works/pi-durable"
import type { Envelope, RoomId } from "@yuki/protocol"
import { measureTurn } from "../experiments/coalescing"
import { TurnExperiment } from "../experiments/turn"
import type { Env } from "../index"
import { AnswerWaiters } from "@yuki/agent/answers"
import { roomStub, userStub } from "../lib/names"
import type { AgentHome } from "../room/room-do"
import type { ApprovalAnswer, ApprovalRequest } from "../room/approvals"
import { findProvider } from "../user/turn-context"
import type { Soul } from "../user/souls"
import { fakeSetup } from "./dev-fake"
import { imageReader } from "./extensions/files"
import type { ChiefPort } from "./extensions/chief"
import { shortBrief } from "../room/brief"
import { CHIEF } from "../room/chief"
import { HOME_PATH, homeBackend, ObjectCache, RoomFs, roomBackend, roomViews, type SoulPort, withMount, withSoul } from "../files/room-fs"
import { mergeRecall, RECALL_MAX, tagHits } from "./recall"
import { type MemoryPort, memoryBlock, memoryDelta, parseZoomId } from "@yuki/memory/tools"
import { roomWorkspacePort } from "./extensions/workspace"
import { type Approvals, isRunTainted } from "@yuki/agent/trust"
import type { MessagingPort } from "./extensions/messaging"
import type { RemindersPort } from "./extensions/reminders"
import { type ComposioTool, learnedSignature } from "../integrations/composio/client"
import { learnedNote } from "../integrations/composio/tools"

import { buildAgent, DEFAULT_MODEL, type UserExtensions, userModels } from "./factory"
import type { GuestResponse, Installed, ScriptPorts } from "@yuki/sandbox/compile"
import { hasScriptWasm, scriptWasm } from "@yuki/sandbox/wasm"
import { checkExtension } from "@yuki/sandbox/check"
import type { BuilderPorts } from "./extensions/builder"
import type { ExtensionBundle, ExtensionInfo, ExtensionResult, ExtensionStateScope } from "@yuki/protocol"
import { createAlarms } from "@yuki/durable/alarm"
import { AgentHost, type AgentSetup, AUTO_RUN_BUDGET_MS, HEARTBEAT_WAKEUP, type HostOptions } from "@yuki/agent/host"
import type { Batch } from "@yuki/agent/inbox"
import { storedRows, wipeStorage } from "@yuki/durable/wipe"
import { instrument } from "../lib/dev-stats"

declare const process: { env: { NODE_ENV?: string } }
import { Outbox, type RoomPort } from "./outbox"

const DEV_FAKE_KEY = "dev-fake"
const DEV_CLASSIC_KEY = "dev-classic"
const DEV_BUDGET_KEY = "dev:auto-budget-ms"
const MEMORY_POS_KEY = "memory:pos"
const MAX_DELTA_TURNS = 32
const USAGE_CARRIED_KEY = "usage:carried"
type EgressRequest = { url: string; method: string; headers: [string, string][]; body: ArrayBuffer | null }
const BUNDLE_PREFIX = "ext-bundle:"
const MODEL_KEY = "model"
const MODEL_APPLIED_KEY = "model:applied"

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
      shortBrief,
      onReset: () => this.outbox.clear(),
      onIdle: () => this.#userExtensions?.release(),
      ...this.hostOptions,
      setup: () => this.setup(),
      onOpen: async (opened) => {
        await this.hostOptions.onOpen?.(opened)
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

  receive(envelopes: Envelope[], brief: string, home?: AgentHome) {
    if (home) this.setHome(home)
    if (envelopes.some((e) => e.from.kind === "human")) this.answers.interrupt()
    return this.host.receive(envelopes, brief)
  }

  stop() {
    return this.host.stop()
  }

  async wake(): Promise<boolean> {
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS wakeups (key TEXT PRIMARY KEY, at INTEGER NOT NULL)")
    const at = this.ctx.storage.sql.exec<{ at: number }>("SELECT at FROM wakeups WHERE key = ?", HEARTBEAT_WAKEUP).toArray()[0]?.at
    if (at === undefined) return false
    if (at > Date.now()) await createAlarms(this.ctx).setWakeup(HEARTBEAT_WAKEUP, Date.now())
    return true
  }

  status() {
    return this.host.status()
  }

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

  protected roomPort(): RoomPort | null {
    const home = this.home()
    if (!home) return null
    const room = () => roomStub(this.env.ROOM, home.userId, home.roomId)
    return {
      post: (runId, attempt, index, block, tainted) => room().post(home.slug, runId, attempt, index, block, tainted),
      draft: (runId, index, text) => room().draft(home.slug, runId, index, text),
      status: (state) => room().setStatus(home.slug, state),
      endRun: async (runId, inputs = []) => room().endRun(home.slug, runId, await this.heard(inputs).catch(() => [])),
      react: (emoji, messageId) => room().react(home.slug, emoji, messageId),
    }
  }

  private remindersPort(): RemindersPort | null {
    const home = this.home()
    if (!home) return null
    const user = () => userStub(this.env.USER, home.userId)
    const room = () => roomStub(this.env.ROOM, home.userId, home.roomId)
    const tz = () => this.#run?.timezone ?? "UTC"
    const mine = async (id: string) => (await user().listReminders()).some((r) => r.id === id && r.roomId === home.roomId)
    const notHere = { ok: false as const, error: "no such reminder in this chat" }
    return {
      create: async (input) => user().createReminder(home.userId, { ...input, tz: input.tz ?? "UTC", roomId: home.roomId as RoomId, createdBy: home.slug, chain: await room().chainOf(home.slug) }),
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
      ask: (callKey, tool, args, summary) => this.ask({ callKey, tool, args, summary, external: false }),
      origin: () => user().publicOrigin(),
    }
  }

  private async composioTools(): Promise<ComposioTool[] | null | "unreachable"> {
    const home = this.home()
    if (!home) return null
    return userStub(this.env.USER, home.userId)
      .composioTools()
      .catch(() => "unreachable" as const)
  }

  async humanComing(): Promise<void> {
    this.host.humanComing()
    this.answers.interrupt()
  }

  async humanGone(): Promise<void> {
    await this.host.humanGone()
  }

  private async heard(inputs: readonly SubmissionId[]): Promise<string[]> {
    if (!inputs.length) return []
    const { storage } = await this.host.open()
    const out: string[] = []
    for (const input of inputs) {
      const submission = await storage.submission(input, BACKGROUND_CONTEXT)
      if (submission?.requestId) out.push(...this.host.inbox.envelopeIds(submission.requestId).filter((id) => id.startsWith("agent:")))
    }
    return out
  }

  async askAnswered(id: string, answer: string, tainted = true): Promise<void> {
    this.answers.answer(id, { text: answer, tainted })
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

  private async report(doing: string): Promise<void> {
    const home = this.home()
    if (home) await roomStub(this.env.ROOM, home.userId, home.roomId).reportDoing(home.slug, doing)
  }

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
      forPrompt: async () => this.#run?.soul ?? (await user().stub.soul(user().slug)),
      set: async (body, expectSha) => {
        if (this.home()?.private) return { ok: false, code: "invalid", message: PRIVATE_REFUSAL }
        const { stub, slug } = user()
        const out = await stub.setSoul(slug, body, expectSha)
        if (out.ok && this.#run) this.#run.soul = out.soul
        return out
      },
    }
  }

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
        inputMemory: (batch, fresh, joined) => this.inputMemory(batch, fresh, joined, false),
        beforeCompact: (harness) => this.carryUsage(harness),
      }
    }
    const egress = this.egressFetch()
    const user = userModels((provider) => this.runAuth(provider), this.ctx.id.toString(), egress)
    const soul = this.soulPort()
    const cache = new ObjectCache()
    const where = () => this.home()
    const notice = (text: string) => {
      const h = this.home()
      return h ? roomStub(this.env.ROOM, h.userId, h.roomId).homeNotice(h.slug, text) : Promise.resolve()
    }
    const locked = () => (this.home()?.private ? PRIVATE_REFUSAL : null)
    const backend = withMount(roomBackend(this.env, where, cache), HOME_PATH, homeBackend(this.env, where, notice, cache, locked))
    const id = `room-files:${this.ctx.id.toString()}`
    const space = withSoul(backend, soul)
    const views = roomViews(id, space, (conversationId) => isRunTainted({ registry: built.registry.snapshot(), conversationId }))
    const files = { fs: new RoomFs(id, space), acceptsImages: imageReader(user.models) }
    const memory = this.memoryPort()
    const composio = await this.composioTools()
    const signature = Array.isArray(composio) ? learnedSignature(composio) : composio
    const scripts = this.scriptPorts()
    const built = buildAgent({ ...role, model: await this.model(), files, soul, runStamp: () => this.#runStamp, chief: this.chiefPort(), presence: (doing) => this.report(doing), memory, messaging, reminders: { port: () => this.remindersPort(), tz: () => this.#run?.timezone ?? "UTC" }, ...(Array.isArray(composio) && home ? { composio: { tools: composio, call: (name, args) => userStub(this.env.USER, home.userId).composioCall(name, args) } } : {}), workspace: roomWorkspacePort(this.env, () => this.home()), approvals: this.approvalsPort(), authority: () => this.host.authority(), ...(scripts ? { scripts, builder: this.builderPorts() } : {}), ...(process.env.NODE_ENV === "development" ? {} : { egress: (url: string, init: RequestInit) => egress(url, init) }) })
    return {
      ...built,
      ...user,
      env: views,
      beginRun: async (batch, root) => {
        this.prefetchDelta(batch)
        if (!(await this.beginRun(batch.requestId, root))) return false
        await this.syncExtensions(built.extensions, root, this.#run?.extensions)
        return true
      },
      inputContext: async () => {
        const tz = this.#run?.timezone ?? "UTC"
        const clock = `now: ${new Date().toISOString()} (${tz}, ${new Date().toLocaleString("en-US", { timeZone: tz, weekday: "long", hour: "numeric", minute: "2-digit" })})`
        const down = composio === "unreachable" ? "composio (the human's connected apps) is unreachable right now, so its tools are missing this run." : undefined
        const learned = Array.isArray(composio) ? learnedNote(composio) : undefined
        const quiet = this.home()?.private ? PRIVATE_NOTE : undefined
        const extensions = this.#extensionsNote ? `the human's installed extensions, live this run: ${this.#extensionsNote}.` : undefined
        return [clock, down, learned, quiet, extensions].filter(Boolean).join("\n\n")
      },
      // A tool another agent learned since this one opened shows up at its next run.
      ...(home ? { stale: () => signature === "unreachable" ? Promise.resolve(false) : userStub(this.env.USER, home.userId).composioSignature().then((now) => now !== signature, () => false) } : {}),
      ...(process.env.NODE_ENV === "development" && (await this.ctx.storage.get<boolean>(DEV_CLASSIC_KEY)) ? {} : { inputMemory: (batch: Batch, fresh: boolean, joined: number[]) => this.inputMemory(batch, fresh, joined) }),
      beforeCompact: (harness) => this.carryUsage(harness),
    }
  }

  private async inputMemory(batch: Batch, fresh: boolean, joined: number[], withLife = true): Promise<{ text?: string; fresh: boolean }> {
    const ahead = this.#delta?.requestId === batch.requestId ? this.#delta.since : null
    this.#delta = undefined
    const home = this.home()
    if (!home) return { fresh }
    const room = roomStub(this.env.ROOM, home.userId, home.roomId)
    const seqs = [...batch.envelopes.map((e) => e.seq), ...joined]
    this.#seqs = seqs
    this.#heard = batch.envelopes.findLast((e) => e.from.kind === "human")?.rootId ?? null
    const seen = await this.ctx.storage.get<number>(MEMORY_POS_KEY)
    if (!fresh && seen !== undefined) {
      const delta = (await ahead) ?? (await room.memorySince(home.slug, seen, seqs))
      if (delta.count - seen <= MAX_DELTA_TURNS) {
        await this.ctx.storage.put(MEMORY_POS_KEY, delta.count)
        return { fresh: false, ...(delta.text ? { text: memoryDelta(delta.text) } : {}) }
      }
    }
    const [view, life] = await Promise.all([room.memoryView(seqs), withLife ? userStub(this.env.USER, home.userId).lifeView() : ""])
    await this.ctx.storage.put(MEMORY_POS_KEY, view.count)
    this.#shown.clear()
    return { fresh: true, text: memoryBlock(life, view.text) }
  }

  #seqs: number[] = []
  #heard: string | null = null
  #shown = new Set<string>()
  #delta?: { requestId: string; since: Promise<{ text: string; count: number } | null> }

  private prefetchDelta(batch: Batch): void {
    const home = this.home()
    if (!home) return
    const since = (async () => {
      const seen = await this.ctx.storage.get<number>(MEMORY_POS_KEY)
      if (seen === undefined) return null
      const seqs = [...batch.envelopes.map((e) => e.seq), ...(await this.host.joinedSeqs())]
      return roomStub(this.env.ROOM, home.userId, home.roomId).memorySince(home.slug, seen, seqs)
    })().catch(() => null)
    this.#delta = { requestId: batch.requestId, since }
  }

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

  private async syncExtensions(extensions: UserExtensions, root: Conversation, versions?: { name: string; hash: string }[]): Promise<void> {
    this.#userExtensions = extensions
    const home = this.home()
    if (!home) return
    const user = userStub(this.env.USER, home.userId)
    try {
      const list = versions ?? (await user.extensionsFor(home.slug))
      const key = JSON.stringify(list)
      if (this.#extensionsSynced?.on === extensions && this.#extensionsSynced.key === key) return
      this.#extensionsSynced = undefined
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
      const keep = new Set(list.map((i) => `${BUNDLE_PREFIX}${i.hash}`))
      const stale = [...(await this.ctx.storage.list({ prefix: BUNDLE_PREFIX })).keys()].filter((k) => !keep.has(k))
      if (stale.length) await this.ctx.storage.delete(stale)
      const problems = extensions.sync(installed)
      for (const p of problems) void user.extensionError(p.name, p.hash, p.error).catch(() => {})
      const broken = new Set(problems.map((p) => p.name))
      this.#extensionsNote = installed
        .filter((i) => !broken.has(i.name))
        .map((i) => `${i.name} ${i.bundle.manifest.version}${Object.keys(i.bundle.manifest.tools ?? {}).length ? ` (tools: ${Object.keys(i.bundle.manifest.tools ?? {}).join(", ")})` : ""}`)
        .join("; ")
      const want = extensions.selection()
      const have = (await root.agent(BACKGROUND_CONTEXT)).extensions.map((e) => e.name)
      if (want.map((e) => e.name).join("\n") !== have.join("\n")) await root.configure({ extensions: want }, BACKGROUND_CONTEXT)
      if (!problems.length) this.#extensionsSynced = { on: extensions, key }
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
      const request = new Request(input as RequestInfo, { ...init, signal: null })
      const body = request.body ? await request.arrayBuffer() : null
      const response = await self().egress({ url: request.url, method: request.method, headers: [...request.headers], body })
      if (!signal || !response.body) return response
      const { readable, writable } = new TransformStream()
      response.body.pipeTo(writable, { signal }).catch(() => {})
      return new Response(readable, { status: response.status, statusText: response.statusText, headers: response.headers })
    }) as typeof fetch
  }

  #userExtensions?: UserExtensions

  #extensionsSynced?: { on: UserExtensions; key: string }

  #extensionsNote = ""

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

  private builderPorts(): BuilderPorts {
    const where = () => {
      const home = this.home()
      if (!home) throw new Error("this agent has no room yet")
      return home
    }
    return {
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

  private async ask(req: ApprovalRequest): Promise<ApprovalAnswer | null> {
    const home = this.home()
    return home ? roomStub(this.env.ROOM, home.userId, home.roomId).requestApproval(home.slug, req) : null
  }

  private approvalsPort(): Approvals {
    return (call) => this.ask({ callKey: `${call.conversationId}:${call.callId}`, tool: call.tool, args: call.arguments, external: true })
  }

  private memoryPort(): MemoryPort | undefined {
    const home = this.home()
    if (!home) return undefined
    const user = () => userStub(this.env.USER, home.userId)
    const room = () => roomStub(this.env.ROOM, home.userId, home.roomId)
    return {
      note: async (text, tainted) => (this.home()?.private ? { ok: false, error: PRIVATE_REFUSAL } : user().lifeNote(home.slug, text, tainted, this.#heard ? `room:${home.roomId}:msg:${this.#heard}` : "")),
      recall: async (query) => {
        const seen = await this.ctx.storage.get<number>(MEMORY_POS_KEY)
        const [life, chat] = await Promise.all([user().lifeRecall(query), room().memoryRecall(query, seen, this.#seqs)])
        return mergeRecall(tagHits("life", life), tagHits("chat", chat), this.#shown, (lines) => user().rerank(query, lines), RECALL_MAX)
      },
      zoom: async (raw) => {
        const id = parseZoomId(raw)
        if (!id) return null
        return id.log === "life" ? user().lifeZoom(id.id) : room().memoryZoom(id.id)
      },
    }
  }

  #run: { provider: string; auth: AuthResult | null; timezone: string; extensions?: { name: string; hash: string }[]; soul?: Soul } | null = null
  #runStamp = 0

  private async beginRun(requestId: string, root: Conversation): Promise<boolean> {
    const home = this.home()
    if (!home) return false
    this.#runStamp++
    const chosen = await this.ctx.storage.get<ModelRef>(MODEL_KEY)
    if (chosen && JSON.stringify(chosen) !== JSON.stringify(await this.ctx.storage.get(MODEL_APPLIED_KEY))) {
      await root.configure({ model: chosen }, BACKGROUND_CONTEXT)
      await this.ctx.storage.put(MODEL_APPLIED_KEY, chosen)
    }
    const model = chosen ?? DEFAULT_MODEL
    const auth = await this.loadAuth(model.provider)
    if (auth) return true
    const heard = this.host.inbox.envelopeIds(requestId).filter((id) => id.startsWith("agent:"))
    await roomStub(this.env.ROOM, home.userId, home.roomId).noProvider(home.slug, model.provider, requestId, heard)
    return false
  }

  private async runAuth(provider: string): Promise<AuthResult | undefined> {
    if (this.#run?.provider === provider) return this.#run.auth ?? undefined
    return (await this.loadAuth(provider)) ?? undefined
  }

  private async loadAuth(provider: string): Promise<AuthResult | null> {
    const home = this.home()
    const context = home ? await userStub(this.env.USER, home.userId).turnContext(provider, home.slug) : null
    this.#run = { provider, auth: context?.auth ?? null, timezone: context?.timezone ?? "UTC", ...(context?.agent ? { extensions: context.agent.extensions, soul: context.agent.soul } : {}) }
    return this.#run.auth
  }

  async model(): Promise<ModelRef> {
    return (await this.ctx.storage.get<ModelRef>(MODEL_KEY)) ?? DEFAULT_MODEL
  }

  async setModel(model: ModelRef): Promise<boolean> {
    if (!findProvider(model.provider)?.getModels().some((m) => m.id === model.modelId)) return false
    await this.ctx.storage.put(MODEL_KEY, { provider: model.provider, modelId: model.modelId })
    return true
  }

  async alarm() {
    if (this.#wiped) return
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

  #wiped = false

  async deleteAll(): Promise<number> {
    if (this.#wiped) return 0
    this.#wiped = true
    await this.hostInstance?.shutdown()
    return wipeStorage(this.ctx)
  }

  async storedRows(): Promise<number> {
    return this.#wiped ? 0 : storedRows(this.ctx.storage)
  }

  async devClassic(): Promise<void> {
    if (process.env.NODE_ENV !== "development") throw new Error("not found")
    await this.ctx.storage.put(DEV_CLASSIC_KEY, true)
  }

  async devUsage(): Promise<{ input: number; output: number; cacheRead: number; cacheWrite: number }> {
    if (process.env.NODE_ENV !== "development") throw new Error("not found")
    if (!this.home()) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    const { harness } = await this.host.open()
    const now = await this.usageOf(harness)
    const carried = (await this.ctx.storage.get<typeof now>(USAGE_CARRIED_KEY)) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    return { input: carried.input + now.input, output: carried.output + now.output, cacheRead: carried.cacheRead + now.cacheRead, cacheWrite: carried.cacheWrite + now.cacheWrite }
  }

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

  async devBudget(ms: number): Promise<void> {
    if (process.env.NODE_ENV !== "development") throw new Error("not found")
    await this.ctx.storage.put(DEV_BUDGET_KEY, ms)
  }

  async devFake(): Promise<void> {
    if (process.env.NODE_ENV !== "development") throw new Error("not found")
    await this.ctx.storage.put(DEV_FAKE_KEY, true)
  }

  async devChildren(): Promise<{ id: string; taskId: string }[]> {
    if (process.env.NODE_ENV !== "development") throw new Error("not found")
    if (!this.home()) return []
    return this.host.children()
  }

  async devSeed(): Promise<void> {
    if (process.env.NODE_ENV !== "development") throw new Error("not found")
    await this.ctx.storage.put("dev-seed", Date.now())
  }
}
