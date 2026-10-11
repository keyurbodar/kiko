import { duplicateDm, newRoomId } from "@yuki/protocol"
import { HomeWiring } from "./home-wiring"
import { RoutineWiring } from "./routines-wiring"
import type { Actor, Agent, AgentSlug, Chat, ChatOp, FileOp, ClientToUser as UserFrame, ComposioResult, RoomId, UserEvent, UserToClient, ExtensionOp, ExtensionResult } from "@yuki/protocol"
import { ClientToUser, type LoopAction, type LoopRow, type UserSettings, type UserSettingsPatch } from "@yuki/protocol/schema"
import { DurableObject } from "cloudflare:workers"
import { instrument } from "../lib/dev-stats"
import { Schema } from "effect"
import type { Env } from "../index"
import { type AutonomousAnswer, type Limits, resolveLimits, takeAutonomous, takeTurn, type TurnAnswer, utcDay } from "./limits"
import { ComposioConnection, composioErrorText } from "../integrations/composio/connect"
import { ComposioStore } from "../integrations/composio/store"
import type { ComposioCallResult, ComposioTool } from "../integrations/composio/client"
import { checkAgentId, kernelErrorText } from "../integrations/kernel/connect"
import { basenameOf, decodeBase64, encodeBase64, FETCH_BODY_CAP, FETCH_METHODS, FILE_CAP, URL_CAP } from "../integrations/kernel/files"
import { KernelError } from "../integrations/kernel/client"
import type { FetchRequest, FetchResult } from "../agent/browser/lease"
import type { Mode } from "../integrations/kernel/client"
import { type Alarms, createAlarms, runDue } from "@yuki/durable/alarm"
import { enforceHello, HELLO_WAKEUP, helloBy } from "@yuki/durable/hello-deadline"
import { yukiChatOps, yukiChatRoom, markYukiChat, movesYukiChat } from "./yuki-chat"
import { keyringFromEnv } from "@yuki/durable/crypto"
import { CredentialVault, type ProviderInfo, userIdFromObjectName } from "./credentials"
import { createAgent, listAgents } from "./agents"
import { firstSoul, type Soul, Souls, type SoulWrite } from "./souls"
import { type CommitResult, type FileBody, FileIndex, type IndexChange, type FsChange, type FsEntry, type FsFail, HOME_TABLES, type NewFile, type PutResult } from "../files/file-index"
import { actorKey } from "../room/log"
import { applyChatOp, type ChatChange, getChat, listChats, searchChats, type Touch, touchChat } from "./chats"
import { Life } from "@yuki/memory/life"
import { importRecords } from "./import-records"
import { itemLine, spanOf } from "@yuki/memory/optmem"
import type { NoteAnswer } from "@yuki/memory/tools"
import { ProviderLogins } from "./provider-login"
import { asResult, type NewReminder, type NewRoutine, REMINDERS_WAKEUP, Reminders, type RoutineRun, type RunDelivery, roomDelivery } from "./reminders"
import { deleteSetting, getSetting, setSetting } from "../lib/settings"
import { type ChatTasks, overview } from "./overview"
import { routineRun, type SignalBatch } from "../room/signals"
import { type RoomRoutine, roomRoutine, type RoutineResult } from "./routines"
import { migrate } from "./schema"
import { DEFAULT_TIMEZONE, resolveTurnContext, type TurnContext } from "./turn-context"
import { getTheme, setTheme } from "./theme"
import { composioUserId, roomStub } from "../lib/names"
import { type ExtensionEvent, ExtensionStore } from "./extensions"
import { EXTENSION_CATALOG } from "./catalog.gen"
import { nextOccurrence } from "./recurrence"
import { CHIEF } from "../room/chief"
import type { GuestRequest, GuestResponse } from "@yuki/sandbox/compile"
import { closeSockets, storedRows, wipeStorage } from "@yuki/durable/wipe"
import type { Certainty, Loop, LoopKind, OpenResult } from "@yuki/memory/loops"
import { INITIATIVE_RUN, INITIATIVE_WAKEUP, REMINDER_RUN } from "../initiative/engine"
import { REAP_WAKEUP } from "../integrations/kernel/lease"
import { type DevBrowserOp, type DevInitiativeOp, devBrowser, devCaptureQueue, devComposioSession, devDue, devInitiative, devSeen, devSetting } from "./dev"
import { InitiativeLoops, LOOPS_WAKEUP } from "./initiative-loops"
import { KernelWiring } from "./kernel-wiring"
import { extensionOp, type ExtensionHost, proposeExtension } from "./extension-wiring"
import { CAPTURE_WAKEUP, LIFE_WAKEUP, MemoryCapture } from "./memory-capture"
import { type Attachment, send, trySend } from "./sockets"
import { LAST_SEEN } from "./keys"

declare const process: { env: { NODE_ENV?: string } }

const REPLAY_LIMIT = 500

const decodeFrame = Schema.decodeUnknownSync(ClientToUser)

const AWAY_NOTICE = "away_notice"
const PUBLIC_ORIGIN = "public_origin"
const OLD_CHECK_IN = "check_in"
const OLD_CHECK_IN_SEEN = "check_in_seen"

const LAST_CHAT = "last_chat"

const DELETING = "deleting"

export class UserDO extends DurableObject<Env> {
  private readonly sql: SqlStorage
  private alarms!: Alarms
  private life!: Life
  private souls!: Souls
  private home!: FileIndex<UserEvent>
  private holding: UserEvent[] | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    instrument(ctx, "user")
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"))
    this.sql = ctx.storage.sql
    void ctx.blockConcurrencyWhile(async () => {
      migrate(this.sql)
      this.alarms = createAlarms(ctx)
      this.life = new Life(this.sql, (fn) => ctx.storage.transactionSync(fn), { get: (key) => this.setting(key), set: (key, value) => this.putSetting(key, value) })
      if (importRecords(this.sql, this.life) > 0) await this.alarms.setWakeup(LIFE_WAKEUP, Date.now())
      this.souls = new Souls(this.sql)
      this.home = new FileIndex<UserEvent>(ctx.storage, HOME_TABLES, (_, body) => {
        const event = this.commit(body)
        if (!event) throw new Error("file change produced no event")
        return event
      }, actorKey)
      this.reminders = new Reminders(this.sql, this.alarms, roomDelivery(env, () => this.reminders.owner()), Date.now, {
        deliverRun: async ({ deliveryId, routine, body, budget }) => {
          return roomStub(env.ROOM, userIdFromObjectName(ctx.id.name), routine.roomId).deliverRoutine(deliveryId, { target: routine.target, body, budget })
        },
        watch: (trigger) => this.#routines.watchPage(trigger),
        notice: (roomId, id, text) => roomStub(env.ROOM, userIdFromObjectName(ctx.id.name), roomId).systemNotice(id, text, "routine"),
        gate: {
          away: () => {
            const last = this.setting(LAST_SEEN)
            const away = last !== null && Date.now() - Number(last) > this.limits().awayDays * 86_400_000
            if (away) this.ctx.waitUntil(this.awayNotice(Date.now()).catch(() => {}))
            return away
          },
        },
        signal: (s) => this.ctx.waitUntil(this.signals({ roomId: s.roomId, openedAt: s.at, signals: [s], more: 0 })),
      })
      this.extensions = new ExtensionStore(
        this.sql,
        () => keyringFromEnv(this.env),
        () => userIdFromObjectName(ctx.id.name),
        (event) => this.commit(event),
        {
          create: async ({ text, rrule, roomId, target, createdBy }) => {
            const tz = this.setting("timezone") ?? DEFAULT_TIMEZONE
            const first = nextOccurrence(rrule, tz, Date.now())
            if (!first) throw new Error("the rule has no next time")
            await this.reminders.create(userIdFromObjectName(ctx.id.name), { text, time: first.toISOString(), tz, rrule, roomId, target, createdBy })
          },
          cancelBy: async (createdBy) => {
            const webhooks = this.sql.exec<{ id: string }>("SELECT id FROM reminders WHERE created_by = ? AND status = 'active' AND json_extract(trigger, '$.on') = 'webhook'", createdBy).toArray()
            const cancelled = await this.reminders.cancelCreatedBy(createdBy)
            for (const { id } of webhooks) await this.#routines.dropHook(id)
            return cancelled
          },
          fallback: () => {
            const roomId = yukiChatRoom(this.sql)
            return roomId ? { roomId, target: CHIEF } : null
          },
        },
        () => EXTENSION_CATALOG,
      )
    })
  }

  private extensions!: ExtensionStore

  async extensionsFor(slug: string) {
    return this.extensions.forAgent(slug)
  }

  async extensionBundles(hashes: string[]) {
    return this.extensions.bundles(hashes)
  }

  async extensionState(name: string, scope: string, op: "get" | "set" | "delete" | "list", key: string, value?: unknown) {
    return this.extensions.state(name, scope, op, key, value)
  }

  async extensionFetch(name: string, request: GuestRequest): Promise<GuestResponse> {
    return this.extensions.fetch(name, request)
  }

  async extensionError(name: string, hash: string, error: string): Promise<void> {
    this.extensions.setError(name, hash, error)
  }

  async extensionList() {
    return this.extensions.list()
  }

  async extensionSource(name: string) {
    try {
      return this.extensions.source(name)
    } catch {
      return null
    }
  }

  async proposeExtension(input: { bundle: unknown; by: string; room: string }): Promise<ExtensionResult> {
    return proposeExtension(this.extensions, input)
  }

  private async extensionOp(op: ExtensionOp): Promise<ExtensionResult> {
    return extensionOp(this.extensions, op, this.extensionHost())
  }

  private extensionHost(): ExtensionHost {
    return { room: this.env.ROOM, userId: userIdFromObjectName(this.ctx.id.name), waitUntil: (work) => this.ctx.waitUntil(work) }
  }

  private reminders!: Reminders
  async createReminder(owner: string, input: NewReminder) { return asResult(() => this.reminders.create(owner, input)) }
  async listReminders() { return this.reminders.list() }
  async cancelReminder(id: string) { return this.#routines.cancelReminder(id) }
  async createRoutine(owner: string, input: NewRoutine): Promise<RoutineResult> { return this.#routines.createRoutine(owner, input) }
  async updateRoutine(id: string, patch: Parameters<Reminders["updateRoutine"]>[1]): Promise<RoutineResult> { return this.#routines.updateRoutine(id, patch) }

  async overview(): Promise<string> {
    const tz = this.setting("timezone") ?? DEFAULT_TIMEZONE
    return overview(this.sql, { reminders: this.reminders.list(), runs: this.reminders.runs(), tz, now: Date.now() })
  }

  async chatTasks(roomId: string, tasks: ChatTasks): Promise<void> {
    if (!tasks.open) this.sql.exec("DELETE FROM chat_tasks WHERE room_id = ?", roomId)
    else this.sql.exec("INSERT INTO chat_tasks (room_id, tasks) VALUES (?, ?) ON CONFLICT(room_id) DO UPDATE SET tasks = excluded.tasks", roomId, JSON.stringify(tasks))
    await this.#il.engine.arm()
  }

  async devSeen(ago: number): Promise<void> {
    return devSeen(this.sql, ago)
  }

  async devSetting(key: "memory_policy", value: string): Promise<void> {
    return devSetting(this.sql, key, value)
  }

  async devComposioSession(): Promise<string | null> {
    return devComposioSession(() => this.#composio)
  }

  async devCaptureQueue(): Promise<number> {
    return devCaptureQueue(this.sql)
  }

  async devDue(id: string): Promise<void> {
    return devDue(this.reminders, id)
  }

  async timezone(): Promise<string | null> {
    return this.setting("timezone")
  }

  async publicOrigin(): Promise<string | null> {
    return this.setting(PUBLIC_ORIGIN)
  }

  async runRoutine(id: string, byHuman = false): Promise<RunDelivery | null> {
    return this.reminders.runNow(id, byHuman)
  }

  async routineRuns(id?: string): Promise<RoutineRun[]> {
    return this.reminders.runs(id)
  }

  async signals(batch: SignalBatch): Promise<void> {
    await this.#il.engine.signals(batch)
    for (const s of batch.signals) if (s.kind === "routine_result" && s.routineId !== INITIATIVE_RUN && s.routineId !== REMINDER_RUN) await this.reminders.finishRun(s.routineId, s.occurrence, s.outcome, s.seq)
    if (!batch.signals.some((s) => s.kind === "burst" || s.kind === "agent_final" || s.kind === "task" || s.kind === "file")) return
    for (const routine of this.reminders.roomRoutines(batch.roomId)) {
      const run = routineRun(roomRoutine(routine), batch)
      if (run) await this.reminders.fireEvent(routine.id, `event:${batch.openedAt}`, "events in this chat", run.body)
    }
  }

  async eventRoutines(roomId: string): Promise<RoomRoutine[]> {
    return this.reminders.roomRoutines(roomId).map(roomRoutine)
  }

  async routineHook(routineId: string, token: string, deliveryKey: string, body: string): Promise<"ran" | "held" | "skipped" | "unknown"> {
    return this.#routines.routineHook(routineId, token, deliveryKey, body)
  }

  async snoozeReminder(id: string, time: string) { return asResult(() => this.reminders.snooze(id, time)) }
  async rewindReminder(id: string) { return asResult(() => this.reminders.rewind(id)) }

  async createChat(roomId: RoomId, title: string, agents?: readonly string[]): Promise<Chat> {
    const op: ChatOp = { op: "create", roomId, title, ...(agents?.length ? { agents } : {}) }
    this.apply(op)
    const chat = getChat(this.sql, this.duplicateOf(op) ?? roomId)
    if (!chat) throw new Error(`chat ${roomId} is missing right after create`)
    return chat
  }

  async renameChat(roomId: RoomId, title: string): Promise<Chat | null> {
    this.apply({ op: "rename", roomId, title })
    return getChat(this.sql, roomId)
  }

  async pinChat(roomId: RoomId, pinned: boolean): Promise<Chat | null> {
    this.apply({ op: "pin", roomId, pinned })
    return getChat(this.sql, roomId)
  }

  async muteChat(roomId: RoomId, muted: boolean): Promise<Chat | null> {
    this.apply({ op: "mute", roomId, muted })
    return getChat(this.sql, roomId)
  }

  async deleteChat(roomId: RoomId): Promise<boolean> {
    return this.apply({ op: "delete", roomId }) !== null
  }

  async touchChat(roomId: RoomId, touch: Touch): Promise<boolean> {
    return this.commit(touchChat(this.sql, roomId, touch, Date.now())) !== null
  }

  async chatTyping(roomId: RoomId, names: readonly string[]): Promise<void> {
    if (!getChat(this.sql, roomId)) return
    this.broadcast({ t: "typing", roomId, names })
  }

  async searchChats(query: string): Promise<Chat[]> {
    return searchChats(this.sql, query)
  }

  async listChats(): Promise<Chat[]> {
    return listChats(this.sql)
  }

  async getChat(roomId: RoomId): Promise<Chat | null> {
    return getChat(this.sql, roomId)
  }

  async createAgent(agent: Agent): Promise<Agent | null> {
    return this.saveAgent(agent)
  }

  async listAgents(): Promise<Agent[]> {
    return listAgents(this.sql)
  }

  async soul(slug: string): Promise<Soul> {
    return this.souls.get(slug)
  }

  async setSoul(slug: string, body: string, expectSha: string): Promise<SoulWrite> {
    return this.souls.set(slug, body, expectSha)
  }

  async homePut(input: NewFile): Promise<Omit<PutResult, "events"> & { fresh: boolean; entry: FsEntry | null }> {
    return this.#homeWiring.put(input)
  }

  async homeStat(path: string): Promise<FsEntry | null> {
    return this.#homeWiring.stat(path)
  }

  async homeList(dir: string, recursive = false): Promise<FsEntry[] | FsFail> {
    return this.#homeWiring.list(dir, recursive)
  }

  async homeMove(by: Actor, from: string, to: string): Promise<FsChange | FsFail> {
    return this.#homeWiring.move(by, from, to)
  }

  async homeRemove(by: Actor, paths: readonly string[], recursive: boolean): Promise<FsChange | FsFail> {
    return this.#homeWiring.remove(by, paths, recursive)
  }

  async homeMkdir(by: Actor, path: string): Promise<FsChange | FsFail> {
    return this.#homeWiring.mkdir(by, path)
  }

  async homeCommit(by: Actor, changes: readonly IndexChange[]): Promise<CommitResult> {
    return this.#homeWiring.commit(by, changes)
  }

  private homeOp(op: FileOp): string | null {
    return this.#homeWiring.op(op)
  }

  async makeAgent(input: { name: string; slug: string; description: string; soul: string; model: string }): Promise<Agent | null> {
    const agent = this.saveAgent({ id: crypto.randomUUID(), name: input.name, slug: input.slug as AgentSlug, prompt: input.description, model: input.model })
    if (!agent) return null
    await this.souls.seed(agent.slug, input.soul)
    return agent
  }

  async openChat(title: string, agents: readonly string[]): Promise<RoomId> {
    const op: ChatOp = { op: "create", roomId: newRoomId(), title, agents }
    this.apply(op)
    return this.duplicateOf(op) ?? op.roomId
  }

  async keepChat(roomId: RoomId, title: string, agents: readonly string[]): Promise<boolean> {
    return this.apply({ op: "keep", roomId, title, agents }) !== null
  }

  async seedSoul(slug: string, name: string, role: string): Promise<Soul> {
    return this.souls.seed(slug, firstSoul(name, role))
  }

  async getTheme(): Promise<string | null> {
    return getTheme(this.sql)
  }

  async setTheme(theme: string | null): Promise<boolean> {
    return this.saveTheme(theme)
  }

  private setting(key: string): string | null {
    return getSetting(this.sql, key)
  }

  private putSetting(key: string, value: string): void {
    setSetting(this.sql, key, value)
  }

  async lifeNote(author: string, text: string, ref = "", replaces?: string): Promise<NoteAnswer> {
    const out = this.life.append(text, `@${author}`, Date.now(), { ref })
    if (!out.ok) return out
    const old = replaces === undefined ? null : /^(?:life:)?\s*#?(\d+)$/i.exec(replaces.trim())
    const replaced = old ? this.life.supersede(Number(old[1]), out.pos) : false
    if (!out.duplicate || replaced) await this.#mem.armNaps()
    return { ok: true, pos: out.pos, ...(out.duplicate ? { duplicate: true as const } : {}), ...(replaces === undefined ? {} : { replaced }) }
  }

  async lifeRollup(roomId: RoomId, text: string, at: number, span?: { lo: number; hi: number }): Promise<void> {
    const chat = getChat(this.sql, roomId)
    if (!chat || chat.private) return
    const out = this.life.append(text, `chat ${chat.title}`, at, span ? { ref: `room:${roomId}:turns:${span.lo}-${span.hi}` } : {})
    if (out.ok && !out.duplicate) await this.#mem.armNaps()
  }

  async lifeRecall(query: string): Promise<string[]> {
    return this.life
      .recall(query, 10, { skipCard: true })
      .map((l) => itemLine({ pos: l.pos, at: l.at, text: `${l.source ? `${l.source}: ` : ""}${l.text}` }, 400, true, "life"))
  }

  async captureHuman(roomId: RoomId, items: { messageId: string; text: string; at: number }[]): Promise<void> {
    await this.#il.hear(roomId, items)
    await this.#mem.captureHuman(roomId, items)
  }

  async forgetMessages(roomId: RoomId, messageIds: string[], requeue: { messageId: string; text: string; at: number }[], turns: number[]): Promise<void> {
    const ids = [...new Set([...messageIds, ...requeue.map((r) => r.messageId)])]
    const gone = this.life.redactRefs(ids.map((id) => `room:${roomId}:msg:${id}`))
    this.#il.loops.redactRefs(ids.map((id) => `room:${roomId}:msg:${id}`))
    this.sql.exec("DELETE FROM capture_queue WHERE room_id = ? AND message_id IN (SELECT value FROM json_each(?))", roomId, JSON.stringify(ids))
    const prefix = `room:${roomId}:turns:`
    const spans = this.life.refsLike(prefix).filter((ref) => {
      const m = /^(\d+)-(\d+)$/.exec(ref.slice(prefix.length))
      return m !== null && turns.some((pos) => Number(m[1]) <= pos && pos < Number(m[2]))
    })
    if (gone.length + this.life.redactRefs(spans).length) await this.#mem.armNaps()
    for (const pos of turns) this.#il.loops.forgetTurn(roomId, pos)
    await this.captureHuman(roomId, requeue)
  }

  async rerank(query: string, lines: { id: string; text: string }[]): Promise<string[] | null> {
    return this.#mem.rerank(query, lines)
  }

  async lifeZoom(id: string): Promise<string | null> {
    const one = /^(\d+)$/.exec(id)
    const span = one ? { lo: Number(one[1]), hi: Number(one[1]) + 1 } : spanOf(id)
    if (!span) return null
    const lines = this.life.zoom(span, Date.now())
    return lines.length ? lines.join("\n") : null
  }

  async memoryUsage(): Promise<Record<string, number>> {
    return this.#mem.usage()
  }

  async compress(prompt: string, page?: { roomId: RoomId; at: number; span?: { lo: number; hi: number } }): Promise<{ text: string } | { retryAt: number } | { error: string }> {
    return this.#mem.compress(prompt, page)
  }

  async connectProvider(provider: string, apiKey: string): Promise<ProviderInfo> {
    const info = await this.#credentials.connect(provider, apiKey)
    await this.#mem.keyChanged(provider)
    return this.#mem.describe(info)
  }

  async disconnectProvider(provider: string): Promise<boolean> {
    const removed = await this.#credentials.disconnect(provider)
    await this.#mem.keyChanged(provider)
    return removed
  }

  async listProviders(): Promise<ProviderInfo[]> {
    return this.#credentials.listProviders().map((p) => this.#mem.describe(p))
  }

  limits(): Limits {
    const raw = this.setting("limits")
    return resolveLimits(raw ? (JSON.parse(raw) as Partial<Limits>) : null)
  }

  setLimits(patch: Partial<Limits>): Limits {
    const next = { ...JSON.parse(this.setting("limits") ?? "{}"), ...patch }
    this.putSetting("limits", JSON.stringify(next))
    return this.limits()
  }

  /** One run nobody's message started, paid once per wake id however often the room asks (section 25.5). */
  takeAutonomous(id: string): AutonomousAnswer {
    const now = Date.now()
    const day = utcDay(now)
    const key = `autonomous:${day}`
    const used = Number(this.setting(key) ?? 0)
    if (this.sql.exec("SELECT 1 FROM autonomous_taken WHERE id = ? AND day = ?", id, day).toArray().length) return { ok: true, used }
    const lastSeen = this.setting(LAST_SEEN)
    const answer = takeAutonomous(used, lastSeen === null ? null : Number(lastSeen), this.limits(), now)
    if (answer.ok) {
      this.putSetting(key, String(answer.used))
      this.sql.exec("DELETE FROM autonomous_taken WHERE day != ?", day)
      this.sql.exec("INSERT OR IGNORE INTO autonomous_taken (id, day) VALUES (?, ?)", id, day)
    } else if (answer.reason === "away") this.ctx.waitUntil(this.awayNotice(now).catch(() => {}))
    return answer
  }

  /** The agent refused the wake `id`: the run it paid for goes back to today's count. */
  refundAutonomous(id: string): void {
    const day = utcDay(Date.now())
    if (!this.sql.exec("DELETE FROM autonomous_taken WHERE id = ? AND day = ?", id, day).rowsWritten) return
    const key = `autonomous:${day}`
    this.putSetting(key, String(Math.max(0, Number(this.setting(key) ?? 0) - 1)))
  }

  private seen(): void {
    const now = Date.now()
    const last = Number(this.setting(LAST_SEEN) ?? 0)
    const wasAway = last > 0 && now - last > this.limits().awayDays * 86_400_000
    if (now - last < 3_600_000) return
    this.putSetting(LAST_SEEN, String(now))
    if (wasAway) deleteSetting(this.sql, AWAY_NOTICE)
  }

  private async awayNotice(now: number): Promise<void> {
    if (this.setting(AWAY_NOTICE) !== null) return
    this.putSetting(AWAY_NOTICE, String(now))
    const roomId = yukiChatRoom(this.sql)
    const owner = userIdFromObjectName(this.ctx.id.name)
    if (roomId) await roomStub(this.env.ROOM, owner, roomId).systemNotice(`away:${now}`, "i paused your routines and follow-ups while you were away. they start again when you open yuki.", "limit")
  }

  takeTurn(): TurnAnswer {
    const now = Date.now()
    const key = `turns:${utcDay(now)}`
    const used = Number(this.setting(key) ?? 0)
    const answer = takeTurn(used, this.limits(), now)
    if (answer.ok) this.putSetting(key, String(answer.used))
    return answer
  }

  async turnContext(provider: string, slug?: string): Promise<TurnContext> {
    const setting = (key: string) =>
      getSetting(this.sql, key)
    const limits = setting("limits")
    const agent = slug ? { extensions: this.extensions.forAgent(slug), soul: await this.souls.get(slug) } : undefined
    return resolveTurnContext(this.#credentials, provider, { timezone: setting("timezone"), limits: limits ? JSON.parse(limits) : null, captures: this.#mem.captures() }, agent)
  }

  async lifeView(): Promise<string> {
    return this.life.view(Date.now())
  }

  #vault?: CredentialVault
  get #credentials(): CredentialVault {
    this.#vault ??= new CredentialVault(this.sql, keyringFromEnv(this.env), userIdFromObjectName(this.ctx.id.name))
    return this.#vault
  }

  #homeWiringCache?: HomeWiring
  get #homeWiring(): HomeWiring {
    this.#homeWiringCache ??= new HomeWiring({ ctx: this.ctx, env: this.env, home: this.home, holding: { set: (held) => { this.holding = held } }, broadcast: (frame) => this.broadcast(frame) })
    return this.#homeWiringCache
  }

  #routinesWiring?: RoutineWiring
  get #routines(): RoutineWiring {
    this.#routinesWiring ??= new RoutineWiring({ env: this.env, reminders: this.reminders, extensions: this.extensions })
    return this.#routinesWiring
  }

  #memory?: MemoryCapture
  get #mem(): MemoryCapture {
    this.#memory ??= new MemoryCapture({
      sql: this.sql,
      life: this.life,
      alarms: this.alarms,
      label: this.ctx.id.toString(),
      credentials: () => this.#credentials,
      turn: (provider) => this.turnContext(provider),
      loops: () => this.#il,
    })
    return this.#memory
  }

  #loopsModule?: InitiativeLoops
  get #il(): InitiativeLoops {
    this.#loopsModule ??= new InitiativeLoops({
      sql: this.sql,
      transaction: (fn) => this.ctx.storage.transactionSync(fn),
      alarms: this.alarms,
      life: this.life,
      memory: this.#mem,
      reminders: this.reminders,
      room: this.env.ROOM,
      userId: userIdFromObjectName(this.ctx.id.name),
      limits: () => this.limits(),
    })
    return this.#loopsModule
  }

  /** Null when no key is stored. A cold object serves the saved listing and refreshes it behind. */
  async composioTools(): Promise<ComposioTool[] | null> {
    return this.#composio.tools()
  }

  /** What an open agent compares with the tools it opened with. Reads one row, never calls Composio. */
  composioSignature(): string | null {
    return this.#composio.signature()
  }

  async composioCall(name: string, args: Record<string, unknown>): Promise<ComposioCallResult> {
    return this.#composio.call(name, args)
  }

  #composioConnection?: ComposioConnection
  get #composio(): ComposioConnection {
    this.#composioConnection ??= new ComposioConnection(
      new ComposioStore(this.sql, keyringFromEnv(this.env), userIdFromObjectName(this.ctx.id.name)),
      () => composioUserId(userIdFromObjectName(this.ctx.id.name)),
      undefined,
      (work) => this.ctx.waitUntil(work),
    )
    return this.#composioConnection
  }

  private async composioFrame(ws: WebSocket, frame: Extract<UserFrame, { t: "connectComposio" | "disconnectComposio" | "composioStatus" }>) {
    const composio = this.#composio
    let result: ComposioResult
    try {
      if (frame.t === "connectComposio") result = { ok: true, ...(await composio.connect(frame.apiKey)) }
      else if (frame.t === "disconnectComposio") {
        composio.disconnect()
        result = { ok: true, status: composio.status() }
      } else {
        const tools = frame.tools ? await composio.tools() : null
        result = { ok: true, status: composio.status(), ...(tools ? { tools: tools.map((t) => t.name), readOnly: tools.flatMap((t) => (t.readOnly ? [t.name] : [])) } : {}) }
      }
    } catch (e) {
      result = { ok: false, error: composioErrorText(e) }
    }
    send(ws, { t: "composio", reqId: frame.reqId, result })
    if (result.ok && frame.t !== "composioStatus") {
      const { tools: _, ...others } = result
      const text = JSON.stringify({ t: "composio", result: others } satisfies UserToClient)
      for (const other of this.ctx.getWebSockets()) {
        if (other !== ws && (other.deserializeAttachment() as Attachment | null)?.ready) trySend(other, text)
      }
    }
  }

  #kernelWiring?: KernelWiring
  get #kr(): KernelWiring {
    this.#kernelWiring ??= new KernelWiring({ ctx: this.ctx, sql: this.sql, env: this.env, alarms: this.alarms, userId: () => userIdFromObjectName(this.ctx.id.name) })
    return this.#kernelWiring
  }

  /** The user's browser for `agentId`, headless unless the human asked to watch. Creates it when there is none. */
  async browserLease(agentId: string): Promise<{ cdpUrl: string; mode: Mode; restarted: boolean; reopen: string[] }> {
    return this.#kr.lease(agentId)
  }

  /** Stamps last use. `tabs` (tab id to last URL) replaces the agent's tabs. False when the browser it knew is gone. */
  async browserTouch(agentId: string, tabs?: Record<string, string>): Promise<boolean> {
    return this.#kr.touch(agentId, tabs)
  }

  /** Whether the human is driving the browser. A tool returns "The human is using the browser" and waits while it is true. */
  async browserTakeover(): Promise<boolean> {
    return this.#kr.kernel.takeover()
  }

  /**
   * An agent asks the human to look at the browser, for a sign-in or a captcha. Posts the reason as a plain
   * message, with no link: the browser bar's Watch and Take over ask for it. `agentId` ends in the agent's slug
   * (after the last "/" or ":"). Returns false when the agent is not in that room.
   */
  async browserShare(agentId: string, roomId: string, reason: string): Promise<boolean> {
    return this.#kr.share(agentId, roomId, reason)
  }

  /** The agent's socket died: the next lease makes a new browser. */
  async browserDead(agentId: string, sessionId: string): Promise<boolean> {
    return this.#kr.dead(agentId, sessionId)
  }

  /** HTTP through the browser's stack. The body is capped at 20000 chars; only http and https. */
  async browserFetch(agentId: string, req: FetchRequest): Promise<FetchResult> {
    checkAgentId(agentId)
    if (typeof req?.url !== "string" || req.url.length > URL_CAP) throw new KernelError("failed", "bad url")
    if (req.method !== undefined && FETCH_METHODS[req.method] !== true) throw new KernelError("failed", "bad method")
    const res = await this.#kr.kernel.fetchPage(req)
    const truncated = res.body.length > FETCH_BODY_CAP
    return { status: res.status, headers: res.headers, body: truncated ? res.body.slice(0, FETCH_BODY_CAP) : res.body, truncated }
  }

  /** Writes an upload into the browser's VM. `name` is sanitized to a basename; the file is capped at 10 MB. */
  async browserPutFile(agentId: string, name: string, base64: string): Promise<{ path: string }> {
    checkAgentId(agentId)
    const bytes = decodeBase64(base64)
    const safe = basenameOf(name)
    return this.#kr.kernel.putFile(safe, bytes)
  }

  /** Reads a file from the browser's VM. The path must be under /tmp or the downloads folder; the file is capped at 10 MB. */
  async browserGetFile(agentId: string, path: string): Promise<{ name: string; base64: string; size: number }> {
    checkAgentId(agentId)
    const bytes = await this.#kr.kernel.getFile(path)
    if (bytes.byteLength > FILE_CAP) throw new KernelError("failed", "file is over 10 MB")
    return { name: basenameOf(path), base64: encodeBase64(bytes), size: bytes.byteLength }
  }

  /** Names of the files in a folder on the browser's VM. The folder must be under /tmp or the downloads folder. */
  async browserListFiles(agentId: string, dir: string): Promise<string[]> {
    checkAgentId(agentId)
    return this.#kr.kernel.listFiles(dir)
  }

  /** The agent closed its tabs. */
  async browserRelease(agentId: string): Promise<void> {
    this.#kr.release(agentId)
  }

  /** Read before each browser call. Holds no URL. */
  async browserCheck(): Promise<{ connected: boolean; takeover: boolean; tabs: Record<string, number> }> {
    return this.#kr.kernel.check()
  }

  async devBrowser(op: DevBrowserOp): Promise<Record<string, unknown>> {
    return devBrowser(() => this.#kr.kernel, userIdFromObjectName(this.ctx.id.name), op)
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 })
    }
    if (this.#wiped || (await this.ctx.storage.get(DELETING))) return new Response("account deleted", { status: 410 })
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ ready: false, helloBy: helloBy() } satisfies Attachment)
    const origin = request.headers.get("origin") ?? new URL(request.url).origin
    if (this.setting(PUBLIC_ORIGIN) !== origin) this.putSetting(PUBLIC_ORIGIN, origin)
    await enforceHello(this.ctx, this.alarms)
    return new Response(null, { status: 101, webSocket: client })
  }

  #logins?: ProviderLogins<WebSocket>
  get #loginState(): ProviderLogins<WebSocket> {
    this.#logins ??= new ProviderLogins<WebSocket>({
      store: this.#credentials,
      info: (provider) => this.#credentials.listProviders().find((p) => p.provider === provider) ?? null,
      send,
      setWakeup: (key, at) => this.alarms.setWakeup(key, at),
      clearWakeup: (key) => this.alarms.clearWakeup(key),
      subscriptions: this.env.PROVIDER_OAUTH === "on",
      fake: process.env.NODE_ENV === "development",
    })
    return this.#logins
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let frame: typeof ClientToUser.Type
    try {
      frame = decodeFrame(JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)))
    } catch {
      return
    }
    if (frame.t === "hello") {
      this.seen()
      send(ws, this.resume(frame.lastSeq))
      // The client starts with no browser, so a hello sends a browser only when there is one.
      const browser = this.#kr.browserState()
      if (browser) send(ws, { t: "browserState", state: browser })
      const before = ws.deserializeAttachment() as Attachment | null
      ws.serializeAttachment({ ...before, ready: true } satisfies Attachment)
      return
    }
    if (frame.t === "connectComposio" || frame.t === "disconnectComposio" || frame.t === "composioStatus") {
      await this.composioFrame(ws, frame)
      return
    }
    if (frame.t === "browserLink" || frame.t === "handBack" || frame.t === "closeBrowser") {
      await this.#kr.browserFrame(ws, frame)
      return
    }
    if (frame.t === "connectKernel" || frame.t === "disconnectKernel" || frame.t === "kernelStatus") {
      await this.#kr.kernelFrame(ws, frame)
      return
    }
    if (frame.t === "memory") {
      send(ws, { t: "memory_result", reqId: frame.reqId, result: await this.#mem.call(frame.op) })
      return
    }
    if (frame.t === "theme") {
      this.saveTheme(frame.theme)
      return
    }
    if (frame.t === "search") {
      send(ws, { t: "search", query: frame.query, chats: searchChats(this.sql, frame.query.slice(0, 200)) })
      return
    }
    if (frame.t === "agent") {
      this.saveAgent(frame.op.agent)
      return
    }
    if (frame.t === "open") {
      this.putSetting(LAST_CHAT, frame.roomId)
      return
    }
    if (frame.t === "extension") {
      send(ws, { t: "extension_result", reqId: frame.reqId, result: await this.extensionOp(frame.op) })
      return
    }
    if (frame.t === "home") {
      const refused = this.homeOp(frame.op)
      if (refused) send(ws, { t: "home_refused", op: frame.op, reason: refused })
      return
    }
    if (frame.t === "login.start") return void this.#loginState.start(ws, frame.loginId, frame.provider).catch(() => {})
    if (frame.t === "login.answer") return this.#loginState.answer(ws, frame.loginId, frame.promptId, frame.value)
    if (frame.t === "login.cancel") return this.#loginState.cancel(ws, frame.loginId)
    const existing = this.duplicateOf(frame.op)
    if (existing) return send(ws, { t: "chat_refused", roomId: frame.op.roomId, existing })
    this.apply(frame.op)
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.#logins?.dropOwner(ws)
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.#logins?.dropOwner(ws)
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code)
    } catch {
    }
  }

  async alarm(): Promise<void> {
    if (this.#wiped || (await this.ctx.storage.get(DELETING))) return
    const due = await this.alarms.dueWakeups(Date.now())
    await runDue(this.alarms, due, {
      [HELLO_WAKEUP]: () => enforceHello(this.ctx, this.alarms),
      [REMINDERS_WAKEUP]: () => this.reminders.fire(),
      [LIFE_WAKEUP]: () => this.#mem.napLife(),
      [CAPTURE_WAKEUP]: () => this.#mem.captureNow(),
      [LOOPS_WAKEUP]: () => this.#il.now(),
      [INITIATIVE_WAKEUP]: () => this.#il.engine.pass(),
      [REAP_WAKEUP]: () => this.#kr.reap(),
    })
    this.#logins?.expire(due)
  }

  async recordRoom(roomId: RoomId): Promise<boolean> {
    if (this.#wiped || (await this.ctx.storage.get(DELETING))) return false
    this.sql.exec("INSERT OR IGNORE INTO rooms (room_id) VALUES (?)", roomId)
    return true
  }

  #wiped = false

  async beginDeletion(): Promise<RoomId[]> {
    if (this.#wiped) return []
    await this.ctx.storage.put(DELETING, Date.now())
    // The user's Kernel account is theirs, so a failure here must not stop the deletion.
    await this.#kr.kernel.wipe().catch((e) => console.error(`kernel wipe failed: ${kernelErrorText(e)}`))
    await this.ctx.storage.deleteAlarm()
    closeSockets(this.ctx)
    this.sql.exec("CREATE TABLE IF NOT EXISTS deletion_rooms (room_id TEXT PRIMARY KEY)")
    this.sql.exec("INSERT OR IGNORE INTO deletion_rooms (room_id) SELECT room_id FROM chats UNION SELECT room_id FROM rooms")
    return this.sql.exec<{ room_id: RoomId }>("SELECT room_id FROM deletion_rooms ORDER BY room_id").toArray().map((r) => r.room_id)
  }

  // The queue refused the jobs, so the account lives on. deletion_rooms stays: a job that did get through must not see an empty ledger and wipe the user.
  async cancelDeletion(): Promise<void> {
    if (this.#wiped) return
    await this.ctx.storage.delete(DELETING)
    // beginDeletion dropped the storage alarm; setting the hello wakeup points it at the earliest row again.
    await enforceHello(this.ctx, this.alarms)
  }

  async roomDeleted(roomId: RoomId): Promise<number> {
    if (this.#wiped) return 0
    this.sql.exec("CREATE TABLE IF NOT EXISTS deletion_rooms (room_id TEXT PRIMARY KEY)")
    this.sql.exec("DELETE FROM deletion_rooms WHERE room_id = ?", roomId)
    return this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM deletion_rooms").one().n
  }

  async deleteAll(): Promise<number> {
    if (this.#wiped) return 0
    // The Composio session goes too, behind the wipe: it reads the key before the rows are gone.
    this.#composio.disconnect()
    const rows = await wipeStorage(this.ctx)
    this.#wiped = true
    return rows
  }

  async storedRows(): Promise<number> {
    return this.#wiped ? 0 : storedRows(this.ctx.storage)
  }

  async devInitiative(op: DevInitiativeOp): Promise<unknown> {
    return devInitiative(() => this.#il.engine, this.reminders, op)
  }

  /** A reminder an agent set for itself opens its commitment (section 26.2); a dev route opens a loop for the fake-agent suite. */
  async loopOpen(owner: string, roomId: RoomId, ref: string, input: { kind: LoopKind; certainty: Certainty; text: string; due: string | null; reminderId?: string }): Promise<OpenResult> {
    return this.#il.open(owner, roomId, ref, input)
  }

  /** `roomId`: an agent's close, which reaches only the loops of its own chat. */
  async loopClose(id: number, status: "done" | "dropped", roomId?: RoomId): Promise<boolean> {
    return this.#il.close(id, status, roomId)
  }

  async loopList(filter: { status?: Loop["status"][]; owner?: string; room?: string; limit?: number } = {}): Promise<Loop[]> {
    return this.#il.loops.list(filter)
  }

  async initiativeBrief(roomId: RoomId, slug: string, burst: { text: string }): Promise<{ owe: string[]; related: string[]; noticed: string[] }> {
    return this.#il.initiative.brief(roomId, slug, burst)
  }

  /** An agent's answer, for the Jev pass to catch a promise to come back (section 26.2). */
  async loopsAnswer(roomId: RoomId, slug: string, items: { messageId: string; text: string; at: number }[]): Promise<void> {
    await this.#il.hear(roomId, items, slug)
  }

  private apply(op: ChatOp): UserEvent | null {
    if (movesYukiChat(this.sql, op) || this.duplicateOf(op)) return null
    const event = this.commit(applyChatOp(this.sql, op, Date.now()))
    // A private or deleted chat keeps no loops (section 26.1).
    if (event && ((op.op === "private" && op.private) || op.op === "delete")) this.#il.loops.forgetRoom(op.roomId)
    if (event && op.op === "private") {
      const room = roomStub(this.env.ROOM, userIdFromObjectName(this.ctx.id.name), op.roomId)
      this.ctx.waitUntil(Promise.resolve(room.setPrivate(op.private)).catch((e: unknown) => console.error(`private flag not sent: ${e instanceof Error ? e.message : String(e)}`)))
    }
    return event
  }

  private duplicateOf(op: ChatOp): RoomId | null {
    if (op.op !== "create" || op.temp || op.agents?.length !== 1) return null
    return duplicateDm(listChats(this.sql).map((c) => markYukiChat(this.sql, c)), op)
  }

  private lastChat(): RoomId | undefined {
    const stored = this.setting(LAST_CHAT)
    const chat = stored ? getChat(this.sql, stored) : null
    return chat && !chat.temp ? chat.roomId : (yukiChatRoom(this.sql) ?? undefined)
  }

  async ensureHome(): Promise<void> {
    for (const op of yukiChatOps(this.sql, (roomId) => getChat(this.sql, roomId) !== null)) this.apply(op)
    const old = this.setting(OLD_CHECK_IN)
    if (old !== null) {
      await this.reminders.cancel(old)
      deleteSetting(this.sql, OLD_CHECK_IN)
      deleteSetting(this.sql, OLD_CHECK_IN_SEEN)
    }
  }

  private saveAgent(agent: Agent): Agent | null {
    const stored = createAgent(this.sql, agent, Date.now())
    if (stored) this.commit({ t: "agent", agent: stored })
    return stored
  }

  private saveTheme(theme: string | null): boolean {
    if (!setTheme(this.sql, theme)) return false
    this.commit({ t: "theme", theme })
    return true
  }

  private currentSeq(): number {
    return this.sql.exec<{ seq: number | null }>("SELECT max(seq) AS seq FROM user_events").one().seq ?? 0
  }

  private commit(change: ChatChange | { t: "agent"; agent: Agent } | { t: "theme"; theme: string | null } | FileBody | ExtensionEvent | null): UserEvent | null {
    if (!change) return null
    if (change.t === "chat") change = { ...change, chat: markYukiChat(this.sql, change.chat) }
    const at = Date.now()
    const seq = this.currentSeq() + 1
    const event = { ...change, seq, at } as UserEvent
    this.sql.exec("INSERT INTO user_events (seq, at, body) VALUES (?, ?, ?)", seq, at, JSON.stringify(event))
    this.sql.exec("DELETE FROM user_events WHERE seq <= ?", seq - REPLAY_LIMIT)
    if (this.holding) this.holding.push(event)
    else this.broadcast({ t: "events", events: [event] })
    return event
  }

  private broadcast(frame: UserToClient): void {
    const text = JSON.stringify(frame)
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() as Attachment | null)?.ready) trySend(ws, text)
    }
  }

  private resume(lastSeq: number): UserToClient {
    const seq = this.currentSeq()
    const { oldest } = this.sql.exec<{ oldest: number | null }>("SELECT min(seq) AS oldest FROM user_events").one()
    const replayable = lastSeq > 0 && lastSeq <= seq && (oldest === null || lastSeq >= oldest - 1)
    if (!replayable) {
      const lastChat = this.lastChat()
      return {
        t: "reset",
        snapshot: { seq, chats: listChats(this.sql).map((c) => markYukiChat(this.sql, c)), agents: listAgents(this.sql), theme: getTheme(this.sql), home: { files: this.home.all(), folders: this.home.folders() }, ...(lastChat ? { lastChat } : {}), extensions: this.extensions.list(), proposals: this.extensions.proposals() },
      }
    }
    const events = this.sql
      .exec<{ body: string }>("SELECT body FROM user_events WHERE seq > ? ORDER BY seq", lastSeq)
      .toArray()
      .map((r) => JSON.parse(r.body) as UserEvent)
    return { t: "events", events }
  }

  // The human's own surfaces for initiative (architecture section 26): the loops list and two settings.

  async loopsFor(roomId: string | null): Promise<LoopRow[]> {
    return this.#il.humanLoops(roomId)
  }

  async loopAct(id: number, action: LoopAction): Promise<boolean> {
    return this.#il.act(id, action)
  }

  async userSettings(): Promise<UserSettings> {
    const timezone = this.setting("timezone")
    return { initiative: this.#il.level(), capture: this.#mem.policy().capture, ...(timezone ? { timezone } : {}) }
  }

  async setUserSettings(patch: UserSettingsPatch): Promise<UserSettings> {
    // The route checked the zone. The rhythm reads hours in it, so the pass is set again.
    if (patch.timezone) {
      this.putSetting("timezone", patch.timezone)
      await this.#il.engine.arm()
    }
    if (patch.initiative) {
      this.putSetting("initiative", patch.initiative)
      await this.#il.engine.arm()
    }
    if (patch.capture) this.#mem.setCapture(patch.capture)
    return this.userSettings()
  }
}
