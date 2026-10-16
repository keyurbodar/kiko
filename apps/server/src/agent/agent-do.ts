import { DurableObject } from "cloudflare:workers"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { AuthResult, Models } from "@earendil-works/pi-ai"
import { type Conversation, type ConversationId, configure, type Harness, type ModelRef, type SubmissionId } from "@earendil-works/pi-durable"
import type { Activity, Envelope, RoomId, ThinkingLevel, WorkerRow } from "@kiko/protocol"
import type { Env } from "../index"
import { AnswerWaiters } from "@kiko/agent/answers"
import { roomStub, userStub } from "../lib/names"
import type { AgentHome } from "../room/room-do"
import type { Soul } from "../user/souls"
import { fakeSetup } from "./dev-fake"
import { imageReader } from "./extensions/files"
import type { ChiefPort } from "./extensions/chief"
import { initiativeBrief, shortBrief } from "../room/brief"
import type { LoopPort } from "@kiko/memory/loop-tool"
import { CHIEF } from "../room/chief"
import { HOME } from "../files/upload"
import { homeBackend, ObjectCache, RoomFs, roomBackend, roomViews, type SoulPort, withMount, withSoul } from "../files/room-fs"
import { mergeRecall, RECALL_MAX, tagHits } from "./recall"
import { type MemoryPort, memoryBlock, memoryDelta, parseZoomId } from "@kiko/memory/tools"
import { roomWorkspacePort } from "./extensions/workspace"
import type { MessagingPort } from "./extensions/messaging"
import type { RemindersPort } from "./extensions/reminders"
import type { RecipesPort } from "./extensions/skills"
import { type ComposioTool, learnedSignature } from "../integrations/composio/client"
import { learnedNote } from "../integrations/composio/tools"

import { buildAgent, DEFAULT_MODEL, userModels } from "./factory"
import { parseModelRef, thinkingFor } from "./thinking"
import { createAlarms } from "@kiko/durable/alarm"
import { migrate } from "@kiko/durable/migrate"
import { AGENT_STEPS } from "./schema"
import { AgentHost, type AgentSetup, HEARTBEAT_WAKEUP, type HostOptions, type HostStatus } from "@kiko/agent/host"
import type { Batch } from "@kiko/agent/inbox"
import type { Work } from "@kiko/agent/workers"
import { BROWSER_IDLE_WAKEUP, BrowserConnection } from "./browser/connection"
import { type LeasePort, type UserBrowserRpc, userLease } from "./browser/lease"
import { jevPort, modelPort, pickDecider } from "./browser/deciders"
import type { DeciderChoice } from "./browser/tools"
import { pickJudge } from "../user/turn-context"

import { count, DEV, instrument, loadAgentDev } from "../lib/dev-guard"
import type { AgentDevHost, Usage } from "./dev"
import { Outbox, type RoomPort } from "./outbox"
import { FIRST_BYTE_MS, guardStall, orStall, STALL_MS } from "./stall"

// Read by the dev methods in agent/dev.ts too, so they share one key per setting.
export const DEV_FAKE_KEY = "dev-fake"
export const DEV_INITIATIVE_KEY = "dev:initiative"
const INITIATIVE_WAIT_MS = 1_500
const MEMORY_POS_KEY = "memory:pos"
const MAX_DELTA_TURNS = 32
const USAGE_CARRIED_KEY = "usage:carried"
const COMPACTIONS_KEY = "compactions"
type EgressRequest = { url: string; method: string; headers: [string, string][]; body: ArrayBuffer | null }
const RECENT_WORKERS = 8
const MODEL_APPLIED_KEY = "model:applied"

const PRIVATE_REFUSAL = "this chat is private: nothing from it is saved to memory, your soul, or /home. carry on without saving."
const PRIVATE_NOTE = "this chat is private. use what you know, but save nothing from it: no memory, no soul edits, nothing in /home."

export class AgentDO extends DurableObject<Env> {
  protected readonly hostOptions: Partial<HostOptions> = {}
  private hostInstance?: AgentHost
  private outboxInstance?: Outbox
  protected readonly answers = new AnswerWaiters()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    instrument(ctx, "agent")
    void ctx.blockConcurrencyWhile(async () => {
      migrate(ctx.storage, AGENT_STEPS)
      void this.host
      void this.outbox
      this.home()
    })
  }

  protected get host(): AgentHost {
    this.hostInstance ??= new AgentHost(this.ctx, {
      progress: () => this.outbox.progress(),
      shortBrief,
      onReset: () => this.outbox.clear(),
      onWorkers: (running, pending) => void this.workersChanged(running, pending),
      waitUntil: (work) => this.ctx.waitUntil(work),
      ...this.hostOptions,
      setup: () => this.setup(),
      onOpen: async (opened) => {
        await this.hostOptions.onOpen?.(opened)
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

  private async workersChanged(running: number, pending: boolean): Promise<void> {
    await this.outbox.workers(this.workerRows()).catch(() => undefined)
    await this.outbox.background(running > 0, pending).catch(() => undefined)
  }

  private workerRows(): WorkerRow[] {
    return this.host.workers
      .list()
      .slice(-RECENT_WORKERS)
      .map((w) => ({ id: w.id, task: w.task, status: w.status, step: w.step, steps: w.steps, startedAt: w.startedAt }))
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

  async receive(envelopes: Envelope[], brief: string, home?: AgentHome) {
    if (home) this.setHome(home)
    const result = await this.host.receive(envelopes, brief)
    if (!result.refused && envelopes.some((e) => e.from.kind === "human")) this.answers.interrupt()
    return result
  }

  async stop(): Promise<{ discarded: number }> {
    return this.host.stop()
  }

  async wake(): Promise<boolean> {
    const at = this.ctx.storage.sql.exec<{ at: number }>("SELECT at FROM wakeups WHERE key = ?", HEARTBEAT_WAKEUP).toArray()[0]?.at
    if (at === undefined) return false
    if (at > Date.now()) await createAlarms(this.ctx).setWakeup(HEARTBEAT_WAKEUP, Date.now())
    return true
  }

  async status(): Promise<HostStatus> {
    return this.host.status()
  }

  protected home(): AgentHome | null {
    const row = this.ctx.storage.sql.exec<{ home: string }>("SELECT home FROM agent_home WHERE id = 1").toArray()[0]
    return row ? (JSON.parse(row.home) as AgentHome) : null
  }

  private homeOrThrow(): AgentHome {
    const home = this.home()
    if (!home) throw new Error("this agent has no room yet")
    return home
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
      post: (runId, attempt, index, block) => room().post(home.slug, runId, attempt, index, block),
      draft: (runId, index, text) => room().draft(home.slug, runId, index, text),
      status: async (state) => {
        await room().setStatus(home.slug, state)
      },
      workers: (rows) => room().setWorkers(home.slug, rows),
      endRun: async (runId, inputs = [], working = false) => room().endRun(home.slug, runId, await this.heard(inputs).catch(() => []), working),
      react: (emoji, messageId) => room().react(home.slug, emoji, messageId),
      runError: (error) => room().runError(home.slug, error),
    }
  }

  private recipesPort(home: { userId: string; roomId: string; slug: string }): RecipesPort {
    const user = () => userStub(this.env.USER, home.userId)
    return { list: () => user().recipeBriefs(home.roomId, home.slug), body: (name) => user().recipeSkillText(name) }
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
      create: async (input) => {
        const out = await user().createReminder(home.userId, { ...input, tz: input.tz ?? "UTC", roomId: home.roomId as RoomId, createdBy: home.slug, chain: await room().chainOf(home.slug) })
        if (out.ok && out.reminder.target === home.slug && !out.reminder.rrule) {
          await user()
            .loopOpen(home.slug, home.roomId, this.#heard ? `room:${home.roomId}:msg:${this.#heard}` : "", { kind: "commitment", certainty: "explicit", text: input.text, due: out.reminder.dueUtc ? new Date(out.reminder.dueUtc).toISOString() : null, reminderId: out.reminder.id })
            .catch(() => {})
        }
        return out
      },
      list: async () => (await user().listReminders()).filter((r) => r.roomId === home.roomId),
      cancel: async (id) => {
        if (!(await mine(id))) return notHere
        const out = await user().cancelReminder(id)
        return out.ok ? { ok: true } : { ok: false, error: out.error }
      },
      createRoutine: async (input) => {
        return user().createRoutine(home.userId, { ...input, target: input.target ?? home.slug, tz: tz(), roomId: home.roomId as RoomId, createdBy: home.slug })
      },
      updateRoutine: async (id, patch) => ((await mine(id)) ? user().updateRoutine(id, patch) : notHere),
      runRoutine: async (id) => ((await mine(id)) ? user().runRoutine(id) : null),
      runs: async (id) => ((await mine(id)) ? user().routineRuns(id) : []),
      origin: () => user().publicOrigin(),
      addRecipe: async (slug) => {
        const out = await user().installRecipe(home.userId, { installId: crypto.randomUUID(), slug, roomId: home.roomId as RoomId, agent: home.slug }, home.slug)
        return out.ok ? { ok: true, setup: out.setup, existed: out.existed } : out
      },
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

  async askAnswered(id: string, answer: string): Promise<boolean> {
    return this.answers.answer(id, answer)
  }

  private messagingPort(): MessagingPort | null {
    const home = this.home()
    if (!home) return null
    const room = () => roomStub(this.env.ROOM, home.userId, home.roomId)
    return {
      send: (input) => room().agentMessage(home.slug, input),
      ask: (input) => room().ask(home.slug, input),
      askState: (id) => room().askState(id),
      waitAnswer: (id, ms, signal) => this.answers.wait(id, ms, signal),
      closeAsk: (id) => room().closeAsk(id),
      askHuman: (input) => room().askHuman(home.slug, input),
      humanAskState: (id) => room().humanAskState(id),
      humanWaiting: () => this.host.humanWaiting(),
      team: () => room().teamNow(),
    }
  }

  private async report(doing: string, activity: Activity): Promise<void> {
    const home = this.home()
    if (home) await roomStub(this.env.ROOM, home.userId, home.roomId).reportDoing(home.slug, doing, activity)
  }

  private chiefPort(): ChiefPort | undefined {
    const home = this.home()
    if (home?.slug !== CHIEF) return undefined
    const room = () => roomStub(this.env.ROOM, home.userId, home.roomId)
    return {
      agents: () => userStub(this.env.USER, home.userId).listAgents(),
      propose: (input) => room().propose(home.slug, input),
      create: (id) => room().createProposal(home.slug, id),
      addToChat: (handles) => room().addToChat(home.slug, handles),
      overview: () => userStub(this.env.USER, home.userId).overview(),
    }
  }

  private soulPort(): SoulPort {
    const user = () => {
      const home = this.homeOrThrow()
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
    if (DEV && (await this.ctx.storage.get<boolean>(DEV_FAKE_KEY))) {
      const browserOn = await this.browserOn()
      const noModel = async (): Promise<DeciderChoice> => { throw new Error("the fake agent has no model for browser_run") }
      const fake = fakeSetup(role, roomWorkspacePort(this.env, () => this.home()), messaging, {
        ...(browserOn && home ? { browser: { connection: () => this.browser(), lease: () => this.browserLease(), decider: noModel, acceptsImages: () => false } } : {}),
        reminders: { port: () => this.remindersPort(), tz: () => "UTC" },
        chief: this.chiefPort(),
        loops: () => this.loopPort(),
        work: this.host.workers,
        presence: (doing, activity) => this.report(doing, activity),
      })
      return {
        ...fake,
        beginRun: async () => true,
        inputMemory: (batch, fresh, joined) => this.inputMemory(batch, fresh, joined, false),
        beforeCompact: (harness) => this.beforeCompact(harness),
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
    const backend = withMount(roomBackend(this.env, where, cache), HOME, homeBackend(this.env, where, notice, cache, locked))
    const id = `room-files:${this.ctx.id.toString()}`
    const space = withSoul(backend, soul)
    const views = roomViews(id, space)
    const files = { fs: new RoomFs(id, space), acceptsImages: imageReader(user.models) }
    const memory = this.memoryPort()
    const composio = await this.composioTools()
    const signature = Array.isArray(composio) ? learnedSignature(composio) : composio
    const browserOn = await this.browserOn()
    const browser = browserOn && home
      ? { connection: () => this.browser(), lease: () => this.browserLease(), decider: () => this.browserDecider(user.models, egress), acceptsImages: imageReader(user.models) }
      : undefined
    const picked = await this.picked()
    const built = buildAgent({ ...(browser ? { browser } : {}), ...role, model: picked.model, thinkingLevel: picked.thinking, files, soul, runStamp: () => this.#runStamp, chief: this.chiefPort(), presence: (doing, activity) => this.report(doing, activity), memory, loops: () => this.loopPort(), messaging, reminders: { port: () => this.remindersPort(), tz: () => this.#run?.timezone ?? "UTC" }, ...(home ? { recipes: this.recipesPort(home) } : {}), ...(Array.isArray(composio) && home ? { composio: { tools: composio, call: (name, args) => userStub(this.env.USER, home.userId).composioCall(name, args) } } : {}), workspace: roomWorkspacePort(this.env, () => this.home()), work: this.host.workers, ...(DEV ? {} : { egress: (url: string, init: RequestInit) => egress(url, init) }) })
    return {
      ...built,
      ...user,
      env: views,
      beginRun: async (batch, root) => {
        this.prefetchDelta(batch)
        this.prefetchInitiative(batch)
        return this.beginRun(batch.requestId, root)
      },
      inputContext: async () => {
        const tz = this.#run?.timezone ?? "UTC"
        const clock = `now: ${new Date().toISOString()} (${tz}, ${new Date().toLocaleString("en-US", { timeZone: tz, weekday: "long", hour: "numeric", minute: "2-digit" })})`
        const down = composio === "unreachable" ? "composio (the human's connected apps) is unreachable right now, so its tools are missing this run." : undefined
        const learned = Array.isArray(composio) ? learnedNote(composio) : undefined
        const quiet = this.home()?.private ? PRIVATE_NOTE : undefined
        const initiative = await this.takeInitiative()
        return [clock, down, learned, quiet, initiative].filter(Boolean).join("\n\n")
      },
      ...(home ? { stale: async () => (await this.browserOn()) !== browserOn || (signature !== "unreachable" && (await userStub(this.env.USER, home.userId).composioSignature().then((now) => now !== signature, () => false))) } : {}),
      inputMemory: (batch: Batch, fresh: boolean, joined: number[]) => this.inputMemory(batch, fresh, joined),
      beforeCompact: (harness) => this.beforeCompact(harness),
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

  #initiative?: Promise<string>

  private prefetchInitiative(batch: Batch): void {
    this.#initiative = undefined
    const home = this.home()
    const human = batch.envelopes.filter((e) => e.from.kind === "human")
    if (!home || home.private || !human.length) return
    const ask = userStub(this.env.USER, home.userId)
      .initiativeBrief(home.roomId, home.slug, { text: human.map((e) => e.body).join("\n").slice(0, 4_000) })
      .then((view) => initiativeBrief(view))
      .catch(() => "")
    this.#initiative = Promise.race([ask, scheduler.wait(INITIATIVE_WAIT_MS).then(() => "")])
  }

  private async takeInitiative(): Promise<string> {
    const pending = this.#initiative
    this.#initiative = undefined
    const text = pending ? await pending : ""
    if (DEV && pending) await this.ctx.storage.put(DEV_INITIATIVE_KEY, text)
    return text
  }

  private loopPort(): LoopPort | null {
    const home = this.home()
    if (!home) return null
    return { close: (id, status) => userStub(this.env.USER, home.userId).loopClose(id, status, home.roomId) }
  }

  async devInitiative(): Promise<string | null> {
    return (await this.dev()).devInitiative(this.agentDevHost())
  }

  private async beforeCompact(harness: Harness): Promise<void> {
    await this.carryUsage(harness)
    const home = this.home()
    if (!home) return
    const count = ((await this.ctx.storage.get<number>(COMPACTIONS_KEY)) ?? 0) + 1
    await this.ctx.storage.put(COMPACTIONS_KEY, count)
    await roomStub(this.env.ROOM, home.userId, home.roomId).compacted(home.slug, String(count)).catch(() => {})
  }

  private async carryUsage(harness: Harness): Promise<void> {
    const now = await this.usageOf(harness)
    const carried = await this.carriedUsage()
    await this.ctx.storage.put(USAGE_CARRIED_KEY, { input: carried.input + now.input, output: carried.output + now.output, cacheRead: carried.cacheRead + now.cacheRead, cacheWrite: carried.cacheWrite + now.cacheWrite })
  }

  private async carriedUsage(): Promise<Usage> {
    return (await this.ctx.storage.get<Usage>(USAGE_CARRIED_KEY)) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  }

  // The one guarded entry for the dev methods in agent/dev.ts: they reach the object's state here.
  private agentDevHost(): AgentDevHost {
    return {
      storage: this.ctx.storage,
      home: () => this.home(),
      opened: () => this.host.open(),
      usageOf: (harness) => this.usageOf(harness),
      carried: () => this.carriedUsage(),
      workers: () => this.host.workers.list(),
    }
  }

  private async usageOf(harness: Harness): Promise<Usage> {
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
   * Architecture section 17.3. One outside request, made in its own invocation. On the Free plan an
   * invocation may make 50 subrequests, and a run's work all belongs to the invocation that started
   * it, so a long run would fail partway. A call through this object's own stub is a new incoming
   * request with a fresh budget, and RPC calls do not count against the 50 (measured 2026-10-04).
   * Only this object calls it, through `egressFetch`.
   */
  async egress(request: EgressRequest): Promise<Response> {
    if (new URL(request.url).protocol !== "https:") throw new Error("egress is https only")
    // check-rules: allow egress the one outside request, made in this object's own invocation, which is the point of egress
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
      const sent = await orStall(self().egress({ url: request.url, method: request.method, headers: [...request.headers], body }), FIRST_BYTE_MS)
      const response = guardStall(sent, STALL_MS)
      if (!signal || !response.body) return response
      const { readable, writable } = new TransformStream()
      response.body.pipeTo(writable, { signal }).catch(() => {})
      return new Response(readable, { status: response.status, statusText: response.statusText, headers: response.headers })
    }) as typeof fetch
  }

  private memoryPort(): MemoryPort | undefined {
    const home = this.home()
    if (!home) return undefined
    const user = () => userStub(this.env.USER, home.userId)
    const room = () => roomStub(this.env.ROOM, home.userId, home.roomId)
    return {
      note: async (text, replaces) =>
        this.home()?.private ? { ok: false, error: PRIVATE_REFUSAL } : user().lifeNote(home.slug, text, this.#heard ? `room:${home.roomId}:msg:${this.#heard}` : "", replaces),
      captures: () => this.#run?.captures ?? false,
      recall: async (query, conversationId) => {
        const root = await this.isRootConversation(conversationId)
        const seen = root ? await this.ctx.storage.get<number>(MEMORY_POS_KEY) : undefined
        const [life, chat] = await Promise.all([user().lifeRecall(query), room().memoryRecall(query, seen, root ? this.#seqs : [])])
        return mergeRecall(tagHits("life", life), tagHits("chat", chat), root ? this.#shown : new Set(), (lines) => user().rerank(query, lines), RECALL_MAX)
      },
      zoom: async (raw) => {
        const id = parseZoomId(raw)
        if (!id) return null
        return id.log === "life" ? user().lifeZoom(id.id) : room().memoryZoom(id.id)
      },
    }
  }

  private async isRootConversation(conversationId: ConversationId): Promise<boolean> {
    return conversationId === (await this.host.rootId())
  }

  #run: { provider: string; auth: AuthResult | null; timezone: string; captures: boolean; soul?: Soul } | null = null
  #runStamp = 0

  private async beginRun(requestId: string, root: Conversation): Promise<boolean> {
    const home = this.home()
    if (!home) return false
    this.#runStamp++
    const turn = await userStub(this.env.USER, home.userId).agentTurn(home.slug)
    const model = parseModelRef(turn.model) ?? DEFAULT_MODEL
    this.#run = { provider: model.provider, auth: turn.auth, timezone: turn.timezone, captures: turn.captures, ...(turn.agent ? { soul: turn.agent.soul } : {}) }
    const applied = { model, thinkingLevel: turn.thinking }
    if (JSON.stringify(applied) !== JSON.stringify(await this.ctx.storage.get(MODEL_APPLIED_KEY))) {
      await root.configure(applied, BACKGROUND_CONTEXT)
      await this.ctx.storage.put(MODEL_APPLIED_KEY, applied)
    }
    if (turn.auth) return true
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
    this.#run = { provider, auth: context?.auth ?? null, timezone: context?.timezone ?? "UTC", captures: context?.captures ?? false, ...(context?.agent ? { soul: context.agent.soul } : {}) }
    return this.#run.auth
  }

  /** The model and level this agent runs on. Kept by the user, so every chat with this agent agrees. */
  private async picked(): Promise<{ model: ModelRef; thinking: ThinkingLevel }> {
    const home = this.home()
    if (!home) return { model: DEFAULT_MODEL, thinking: thinkingFor(DEFAULT_MODEL) }
    const picked = await userStub(this.env.USER, home.userId).agentModel(home.slug)
    return { model: parseModelRef(picked.model) ?? DEFAULT_MODEL, thinking: picked.thinking }
  }

  async model(): Promise<ModelRef> {
    return (await this.picked()).model
  }

  async alarm() {
    if (await this.browserIdle()) return
    await this.host.alarm()
  }

  #browser?: BrowserConnection
  #browserLease?: LeasePort

  private async browserOn(): Promise<boolean> {
    const home = this.home()
    if (!home) return false
    return (userStub(this.env.USER, home.userId) as unknown as UserBrowserRpc).browserCheck().then((s) => s.connected, () => false)
  }

  private browserLease(): LeasePort {
    const home = this.homeOrThrow()
    this.#browserLease ??= userLease(() => userStub(this.env.USER, home.userId) as unknown as UserBrowserRpc, `${home.roomId}:${home.slug}`, home.roomId)
    return this.#browserLease
  }

  private browser(): BrowserConnection {
    const home = this.homeOrThrow()
    this.#browser ??= new BrowserConnection({
      agentId: `${home.roomId}:${home.slug}`,
      lease: this.browserLease(),
      idle: { arm: (at) => createAlarms(this.ctx).setWakeup(BROWSER_IDLE_WAKEUP, at) },
    })
    return this.#browser
  }

  private async browserDecider(models: Models, egress: typeof fetch): Promise<DeciderChoice> {
    const home = this.home()
    const own = modelPort(models, await this.model(), this.ctx.id.toString())
    if (home) {
      const user = userStub(this.env.USER, home.userId)
      const picked = pickJudge(await user.listProviders(), (p) => p.refused === true)
      const auth = picked ? (await user.turnContext(picked.provider)).auth : null
      if (picked && auth) {
        const jevModels = userModels(async () => auth, `browser-${this.ctx.id.toString()}`, egress).models
        return { name: "jev", ...pickDecider(own, jevPort(jevModels, { provider: picked.provider, auth }, egress)) }
      }
    }
    return { name: "model", ...pickDecider(own, null) }
  }

  /**
   * Closes the browser socket when its idle wakeup is due. The host's alarm would drop the row as
   * due without knowing it, so this runs first. True when nothing else was due.
   */
  private async browserIdle(): Promise<boolean> {
    const now = Date.now()
    const due = this.ctx.storage.sql.exec<{ key: string }>("SELECT key FROM wakeups WHERE at <= ?", now).toArray().map((r) => r.key)
    if (!due.includes(BROWSER_IDLE_WAKEUP)) return false
    await createAlarms(this.ctx).clearWakeup(BROWSER_IDLE_WAKEUP)
    if (this.#browser && (await this.#browser.idle()) === "closed") count("browser.idle.closed")
    else if (this.home()) await this.browserLease().release().catch(() => {})
    return due.length === 1
  }

  // The dev-only bodies live in agent/dev.ts, which only a development build can load. One cached load
  // per object reaches every dev method below.
  #dev?: Promise<typeof import("./dev")>

  private dev(): Promise<typeof import("./dev")> {
    this.#dev ??= loadAgentDev()
    return this.#dev
  }

  async devUsage(): Promise<Usage> {
    return (await this.dev()).devUsage(this.agentDevHost())
  }

  async devTrace(): Promise<{ kind: string; tool?: string; chars: number; text?: string }[]> {
    return (await this.dev()).devTrace(this.agentDevHost())
  }

  async devFake(): Promise<void> {
    return (await this.dev()).devFake(this.agentDevHost())
  }

  async devWorkers(): Promise<Work[]> {
    return (await this.dev()).devWorkers(this.agentDevHost())
  }
}
