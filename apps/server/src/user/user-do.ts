import { duplicateDm, newRoomId } from "@kiko/protocol"
import type { Actor, Agent, AgentSlug, Chat, ChatOp, FileOp, ClientToUser as UserFrame, ExecutorResult, ExecutorStatus, MemoryModel, MemoryOp, MemoryResult, RoomId, UserEvent, UserToClient } from "@kiko/protocol"
import { ClientToUser } from "@kiko/protocol/schema"
import { DurableObject } from "cloudflare:workers"
import { instrument } from "../lib/dev-stats"
import { Schema } from "effect"
import type { Env } from "../index"
import { type CallbackParams, errorText, ExecutorConnection, ExecutorError } from "../integrations/executor/connect"
import { ExecutorTokenStore } from "../integrations/executor/token-store"
import { type AutonomousAnswer, type Limits, resolveLimits, takeAutonomous, takeTurn, type TurnAnswer, utcDay } from "./limits"
import type { ExecutorTool } from "../integrations/executor/tools"
import { type Alarms, createAlarms, runDue } from "../lib/alarm"
import { enforceHello, HELLO_WAKEUP, helloBy } from "../lib/hello-deadline"
import { kikoChatOps, kikoChatRoom, markKikoChat, movesKikoChat } from "./kiko-chat"
import { keyringFromEnv } from "../lib/crypto"
import { CredentialVault, type ProviderInfo, userIdFromObjectName } from "./credentials"
import { createAgent, listAgents } from "./agents"
import { firstSoul, type Soul, Souls, type SoulWrite } from "./souls"
import { type CommitResult, type FileBody, FileIndex, type IndexChange, type FsChange, type FsEntry, type FsFail, HOME_TABLES, type NewFile, type PutResult } from "../files/file-index"
import { cleanPath, deleteFiles } from "../files/upload"
import { actorKey } from "../room/log"
import { applyChatOp, type ChatChange, getChat, listChats, searchChats, type Touch, touchChat } from "./chats"
import { Life } from "./life"
import { cleanLine, itemLine, MAX_NAP_FAILS, NAP_SYSTEM, spanOf } from "../lib/optmem"
import { ProviderLogins } from "./provider-login"
import { asResult, type NewReminder, REMINDERS_WAKEUP, Reminders, roomDelivery } from "./reminders"
import { migrate } from "./schema"
import { DEFAULT_TIMEZONE, findProvider, resolveTurnContext, type TurnContext } from "./turn-context"
import { getTheme, setTheme } from "./theme"
import { DEFAULT_MODEL, userModels } from "../agent/factory"
import { roomStub } from "../lib/names"
import { type ExtensionEvent, ExtensionError, ExtensionStore } from "./extensions"
import { EXTENSION_CATALOG } from "./catalog.gen"
import { nextOccurrence } from "./recurrence"
import { CHIEF } from "../room/chief"
import type { ExtensionOp, ExtensionResult } from "@kiko/protocol"
import type { GuestRequest, GuestResponse } from "../agent/script/compile"
import { closeSockets, storedRows, wipeStorage } from "../lib/wipe"

// Wrangler replaces this when it bundles: "development" under `wrangler dev`.
declare const process: { env: { NODE_ENV?: string } }

// Architecture sections 4.1 and 9. One object per user. This part owns the chat
// index and the user socket. Every change is stored as an event with a per-user `seq`
// and sent to every socket that has said hello. A client that reconnects sends the
// last `seq` it applied and gets the events after it, or a snapshot when the gap is
// too old to replay.

/** Events kept for replay. An older `lastSeq` gets a snapshot. Same limit as the room. */
const REPLAY_LIMIT = 500

/** `origin` is the Worker origin the socket came through. The Executor callback URL is built from it. */
type Attachment = { ready: boolean; helloBy?: number; origin?: string }

const decodeFrame = Schema.decodeUnknownSync(ClientToUser)

/** The wakeup that makes the life log's summaries. */
const LIFE_WAKEUP = "life_naps"
/** Summaries per alarm, and at once per user across every room. */
const NAPS_PER_ALARM = 4
const MAX_NAPS = 4
/** ASSUMPTION: the longest one summary call may take. A model that always thinks needs more than a minute for a page. */
const COMPRESS_TIMEOUT_MS = 120_000
/** The `settings` key of what memory summaries have spent: input, output, cacheRead, calls. */
const MEMORY_USAGE = "memory_usage"
/** The `settings` key of the memory model the human chose. */
const MEMORY_MODEL = "memory_model"
/** Section 25.5. When the human last opened kiko, and whether the away line was posted. */
const LAST_SEEN = "last_seen"
const AWAY_NOTICE = "away_notice"

/** The `settings` key of the chat the user was last in. */
const LAST_CHAT = "last_chat"

/** The storage key that marks an account deletion in progress. */
const DELETING = "deleting"

export class UserDO extends DurableObject<Env> {
  private readonly sql: SqlStorage
  // Reminders and the life log's summaries register wakeups here in their own tasks.
  // Set in the constructor's `blockConcurrencyWhile`, which ends before any request or alarm runs.
  private alarms!: Alarms
  private life!: Life
  private souls!: Souls
  private home!: FileIndex<UserEvent>
  /** Events of a batch still in its transaction (`homeCommit`), broadcast once it commits. */
  private holding: UserEvent[] | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    instrument(ctx, "user")
    // The client's liveness ping, answered by the runtime without waking this object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"))
    this.sql = ctx.storage.sql
    // Architecture section 23: the schema migration runs before any other work on every start.
    void ctx.blockConcurrencyWhile(async () => {
      migrate(this.sql)
      this.alarms = createAlarms(ctx)
      this.life = new Life(this.sql, (fn) => ctx.storage.transactionSync(fn), { get: (key) => this.setting(key), set: (key, value) => this.putSetting(key, value) })
      // The records store this log replaced is read once into it, then dropped (architecture section 13).
      if (this.life.importRecords() > 0) await this.alarms.setWakeup(LIFE_WAKEUP, Date.now())
      this.souls = new Souls(this.sql)
      this.home = new FileIndex<UserEvent>(ctx.storage, HOME_TABLES, (_, body) => this.commit(body)!, actorKey)
      this.reminders = new Reminders(this.sql, this.alarms, roomDelivery(env, () => this.reminders.owner()))
      this.extensions = new ExtensionStore(
        this.sql,
        () => keyringFromEnv(this.env),
        () => userIdFromObjectName(ctx.id.name),
        (event) => this.commit(event),
        {
          // A trigger is a recurring reminder (section 14), made as the extension.
          create: async ({ text, rrule, roomId, target, createdBy }) => {
            const tz = this.sql.exec<{ value: string }>("SELECT value FROM settings WHERE key = 'timezone'").toArray()[0]?.value ?? DEFAULT_TIMEZONE
            const first = nextOccurrence(rrule, tz, Date.now())
            if (!first) throw new Error("the rule has no next time")
            await this.reminders.create(userIdFromObjectName(ctx.id.name), { text, time: first.toISOString(), tz, rrule, roomId, target, createdBy })
          },
          cancelBy: (createdBy) => this.reminders.cancelCreatedBy(createdBy),
          fallback: () => {
            const roomId = kikoChatRoom(this.sql)
            return roomId ? { roomId, target: CHIEF } : null
          },
        },
        () => EXTENSION_CATALOG,
      )
    })
  }

  // Extensions, architecture section 24. The logic is in extensions.ts. Agents reach these RPCs with
  // a stub the Worker addressed by the session's user id, so every call is this user's own.
  private extensions!: ExtensionStore

  /** The versions agent `slug` runs this run. */
  async extensionsFor(slug: string) {
    return this.extensions.forAgent(slug)
  }

  async extensionBundles(hashes: string[]) {
    return this.extensions.bundles(hashes)
  }

  /** `kiko.state` for a running script. Throws a message the script can read. */
  async extensionState(name: string, scope: string, op: "get" | "set" | "delete" | "list", key: string, value?: unknown) {
    return this.extensions.state(name, scope, op, key, value)
  }

  /** `kiko.fetch` for a running script. Secrets are filled in here and never leave this object. */
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

  /** An agent's `extension_propose`. The human installs it from settings; an agent never can. */
  async proposeExtension(input: { bundle: unknown; by: string; room: string; tainted: boolean }): Promise<ExtensionResult> {
    return this.extensionResult(async () => ({ proposal: await this.extensions.propose({ bundle: input.bundle, source: "agent", by: input.by, room: input.room, tainted: input.tainted }) }))
  }

  /** The human's `extension` frame. Only a socket reaches this, so only the human installs. */
  private async extensionOp(op: ExtensionOp): Promise<ExtensionResult> {
    const x = this.extensions
    return this.extensionResult(async () => {
      switch (op.op) {
        case "propose":
          return { proposal: await x.propose({ bundle: op.bundle, source: "human", ...(op.room ? { room: op.room } : {}) }) }
        case "catalog":
          return { catalog: EXTENSION_CATALOG }
        case "propose_catalog":
          return { proposal: await x.proposeCatalog(op.name) }
        case "install": {
          const extension = await x.install(op.id)
          // The chat an agent proposed it from hears that it is live, and so does the agent at its next delivery.
          if (extension.room && extension.by) {
            const room = roomStub(this.env.ROOM, userIdFromObjectName(this.ctx.id.name), extension.room)
            this.ctx.waitUntil(Promise.resolve(room.homeNotice(extension.by, `the ${extension.name} extension is installed. its tools work from the next message.`)).catch(() => {}))
          }
          return { extension }
        }
        case "decline":
          x.decline(op.id)
          return {}
        case "enable":
          return { extension: await x.setEnabled(op.name, op.enabled) }
        case "agents":
          return { extension: x.setAgents(op.name, op.agents) }
        case "secret":
          return { extension: await x.setSecret(op.name, op.secret, op.value) }
        case "uninstall":
          await x.uninstall(op.name)
          return {}
        case "source":
          return { bundle: x.source(op.name) }
      }
    })
  }

  private async extensionResult(run: () => Promise<Omit<Extract<ExtensionResult, { ok: true }>, "ok">>): Promise<ExtensionResult> {
    try {
      return { ok: true, ...(await run()) }
    } catch (e) {
      if (e instanceof ExtensionError) return { ok: false, error: e.message, ...(e.problems ? { problems: e.problems } : {}) }
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  // Reminders, architecture section 14. The logic is in reminders.ts. `owner` is the
  // session's user id from the Worker, the one place this object learns it.
  private reminders!: Reminders
  async createReminder(owner: string, input: NewReminder) { return asResult(() => this.reminders.create(owner, input)) }
  async listReminders() { return this.reminders.list() }
  async cancelReminder(id: string) { return asResult(() => this.reminders.cancel(id)) }
  async snoozeReminder(id: string, time: string) { return asResult(() => this.reminders.snooze(id, time)) }
  async rewindReminder(id: string) { return asResult(() => this.reminders.rewind(id)) }

  // RPC. The Worker and the user's rooms call these. The object is already the user's
  // own, so no method takes a user id.

  /**
   * Adds a chat. A repeat for the same room changes nothing and returns the stored row. A second
   * direct chat with one agent is not made: the agent's one direct chat comes back instead.
   */
  async createChat(roomId: RoomId, title: string, agents?: readonly string[]): Promise<Chat> {
    const op: ChatOp = { op: "create", roomId, title, ...(agents?.length ? { agents } : {}) }
    this.apply(op)
    return getChat(this.sql, this.duplicateOf(op) ?? roomId)!
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

  /** Returns true when the chat existed. */
  async deleteChat(roomId: RoomId): Promise<boolean> {
    return this.apply({ op: "delete", roomId }) !== null
  }

  /**
   * A room calls this when its newest activity, read position, or members change, and at the end
   * of a run. Returns true when it changed the row and broadcast. A repeat with the same `lastSeq`
   * returns false and sends nothing.
   */
  async touchChat(roomId: RoomId, touch: Touch): Promise<boolean> {
    return this.commit(touchChat(this.sql, roomId, touch, Date.now())) !== null
  }

  /**
   * A room calls this when the set of its agents that are typing changes, so the chat list can say
   * who is typing in a chat that is not open. Sent, never stored: a client that connects later sees
   * the next change.
   */
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

  /** One chat, or null when the user has no chat for the room. The room asks before each delivery. */
  async getChat(roomId: RoomId): Promise<Chat | null> {
    return getChat(this.sql, roomId)
  }

  /** Adds an agent and tells every socket. Returns null when the id or the handle is taken or the input is refused. */
  async createAgent(agent: Agent): Promise<Agent | null> {
    return this.saveAgent(agent)
  }

  async listAgents(): Promise<Agent[]> {
    return listAgents(this.sql)
  }

  /** An agent's soul (section 7.10), made on first read. The agent reads it on every request. */
  async soul(slug: string): Promise<Soul> {
    return this.souls.get(slug)
  }

  /** Replaces an agent's soul, by the agent itself or by the human. */
  async setSoul(slug: string, body: string, expectSha?: string): Promise<SoulWrite> {
    return this.souls.set(slug, body, expectSha)
  }

  // The user's drive, /home (architecture section 18.3). The same index and rules as a chat's
  // files; its R2 keys sit under the user's prefix like every other object.

  /** RPC for an upload to the drive, and for an agent's write. */
  async homePut(input: NewFile): Promise<Omit<PutResult, "events"> & { fresh: boolean; entry: FsEntry | null }> {
    const { events, ...result } = this.home.put(input)
    return { ...result, fresh: events.some((e) => e.t === "file"), entry: result.file && !result.conflict ? this.home.stat(input.path) : null }
  }

  async homeStat(path: string): Promise<FsEntry | null> {
    return this.home.stat(path)
  }

  async homeList(dir: string, recursive = false): Promise<FsEntry[] | FsFail> {
    return this.home.list(dir, recursive)
  }

  async homeMove(by: Actor, from: string, to: string): Promise<FsChange | FsFail> {
    return this.dropAfter(this.home.move(from, to, by))
  }

  async homeRemove(by: Actor, paths: readonly string[], recursive: boolean): Promise<FsChange | FsFail> {
    return this.dropAfter(this.home.remove(paths, recursive, by))
  }

  async homeMkdir(by: Actor, path: string): Promise<FsChange | FsFail> {
    return this.home.mkdir(path, by)
  }

  /** RPC for a bash command's changes to the drive (section 18.4): all in one transaction, or none. */
  async homeCommit(by: Actor, changes: readonly IndexChange[]): Promise<CommitResult> {
    // A refused batch rolls its events back, so nothing is broadcast until it holds.
    const held: UserEvent[] = []
    this.holding = held
    let out: CommitResult<UserEvent>
    try {
      out = this.home.commit(changes, by)
    } finally {
      this.holding = null
    }
    if (!out.ok) return out
    if (held.length) this.broadcast({ t: "events", events: held })
    this.dropAfter({ ok: true, events: [], drop: out.drop, changed: changes.length })
    return { ok: true, events: [], drop: [] }
  }

  /** A human's `home` frame. The refusal for the socket, or null. */
  private homeOp(op: FileOp): string | null {
    const human = { kind: "human" } as const
    const paths = op.op === "rm" ? op.paths : op.op === "mv" ? [op.from, op.to] : [op.path]
    if (paths.some((p) => cleanPath(p) === null)) return "that is not a path in your drive"
    const out = op.op === "rm" ? this.dropAfter(this.home.remove(op.paths, op.recursive ?? false, human)) : op.op === "mv" ? this.dropAfter(this.home.move(op.from, op.to, human)) : this.home.mkdir(op.path, human)
    return out.ok ? null : out.message
  }

  /** Deletes the R2 objects nothing points to any more. */
  private dropAfter<T extends FsChange | FsFail>(out: T): T {
    if (out.ok && out.drop.length) this.ctx.waitUntil(deleteFiles(this.env.FILES, out.drop).catch((e: unknown) => console.error(`r2 delete failed: ${e instanceof Error ? e.message : String(e)}`)))
    return out
  }

  // kiko makes agents and groups (architecture section 7.11). The room checks the human said yes;
  // these only store, in the same shapes a client's frames would.

  /** A new agent with the soul kiko wrote. Null when the handle is taken or the input is refused. */
  async makeAgent(input: { name: string; slug: string; description: string; soul: string; model: string }): Promise<Agent | null> {
    const agent = this.saveAgent({ id: crypto.randomUUID(), name: input.name, slug: input.slug as AgentSlug, prompt: input.description, model: input.model })
    if (!agent) return null
    await this.souls.seed(agent.slug, input.soul)
    return agent
  }

  /** A new chat with these agents (ids), in the list at once. Returns its room id, or the agent's one direct chat when it has one. */
  async openChat(title: string, agents: readonly string[]): Promise<RoomId> {
    const op: ChatOp = { op: "create", roomId: newRoomId(), title, agents }
    this.apply(op)
    return this.duplicateOf(op) ?? op.roomId
  }

  /** A temporary chat becomes a group in the list, with its title and agents (ids). False when it was not temporary. */
  async keepChat(roomId: RoomId, title: string, agents: readonly string[]): Promise<boolean> {
    return this.apply({ op: "keep", roomId, title, agents }) !== null
  }

  /** A first soul for an agent the lead added, from the role it gave. Keeps a soul that exists. */
  async seedSoul(slug: string, name: string, role: string): Promise<Soul> {
    return this.souls.seed(slug, firstSoul(name, role))
  }

  /** The theme JSON text, or null. */
  async getTheme(): Promise<string | null> {
    return getTheme(this.sql)
  }

  /** Saves or clears the theme and tells every socket. Returns false when it changed nothing. */
  async setTheme(theme: string | null): Promise<boolean> {
    return this.saveTheme(theme)
  }

  // Memory: the user's life log (architecture section 13). The logic is in life.ts and lib/optmem.ts.

  private setting(key: string): string | null {
    return this.sql.exec<{ value: string }>("SELECT value FROM settings WHERE key = ?", key).toArray()[0]?.value ?? null
  }

  private putSetting(key: string, value: string): void {
    this.sql.exec("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value)
  }

  /** The memory screen's requests. Only the human's socket reaches it: pin, redact, and the model are theirs. */
  private async memoryCall(op: MemoryOp): Promise<MemoryResult> {
    const now = Date.now()
    switch (op.op) {
      case "list": {
        const lines = this.life.list(op.before ?? null, op.limit ?? 50)
        return { ok: true, lines, next: lines.length ? lines[lines.length - 1]!.pos : null }
      }
      case "view":
        return { ok: true, text: this.life.view(now).split("\n").filter(Boolean) }
      case "search":
        return { ok: true, lines: this.life.recall(op.query, 30), next: null }
      case "zoom": {
        const span = spanOf(op.id)
        return span ? { ok: true, text: this.life.zoom(span, now) } : { ok: false, error: "not a summary id" }
      }
      case "note": {
        const out = this.life.append(op.text, "you", false)
        if (out.ok) await this.armNaps()
        return out.ok ? { ok: true } : out
      }
      case "pin":
        return this.life.pin(op.pos, op.pinned)
      case "redact":
        if (!this.life.redact(op.pos)) return { ok: false, error: "no such memory" }
        await this.armNaps()
        return { ok: true }
      case "model":
        return { ok: true, model: this.memoryModel() }
      case "set_model":
        if (op.model && !findProvider(op.model.provider)?.getModels().some((m) => m.id === op.model!.modelId)) return { ok: false, error: "no such model" }
        if (op.model) this.putSetting(MEMORY_MODEL, JSON.stringify(op.model))
        else this.sql.exec("DELETE FROM settings WHERE key = ?", MEMORY_MODEL)
        return { ok: true }
    }
  }

  /** The model that writes summaries: the one the human chose, else the default. */
  private memoryModel(): MemoryModel {
    const raw = this.setting(MEMORY_MODEL)
    return raw ? (JSON.parse(raw) as MemoryModel) : null
  }

  /** RPC for an agent's `note`. A private chat never writes (section 7.10); the agent checks that first. */
  async lifeNote(author: string, text: string, tainted: boolean): Promise<{ ok: true; duplicate?: true } | { ok: false; error: string }> {
    const out = this.life.append(text, `@${author}`, tainted)
    if (!out.ok) return out
    if (!out.duplicate) await this.armNaps()
    return out.duplicate ? { ok: true, duplicate: true } : { ok: true }
  }

  /** RPC for a room's rollup: a settled stretch of a chat, as one line. Private chats never call it. */
  async lifeRollup(roomId: RoomId, text: string, tainted: boolean, at: number): Promise<void> {
    const chat = getChat(this.sql, roomId)
    if (!chat || chat.private) return
    const out = this.life.append(text, `chat ${chat.title}`, tainted, at)
    if (out.ok && !out.duplicate) await this.armNaps()
  }

  /** RPC for an agent's `recall`: life lines that match. */
  async lifeRecall(query: string): Promise<string[]> {
    return this.life.recall(query, 10).map((l) => itemLine({ pos: l.pos, at: l.at, text: `${l.source ? `${l.source}: ` : ""}${l.text}`, tainted: l.tainted }, 400))
  }

  /** RPC for an agent's `zoom` on a life id. */
  async lifeZoom(id: string): Promise<string | null> {
    const one = /^(\d+)$/.exec(id)
    const span = one ? { lo: Number(one[1]), hi: Number(one[1]) + 1 } : spanOf(id)
    if (!span) return null
    const lines = this.life.zoom(span, Date.now())
    return lines.length ? lines.join("\n") : null
  }

  /** What memory summaries have spent so far, for `verify token-cost`. */
  async memoryUsage(): Promise<Record<string, number>> {
    return JSON.parse(this.setting(MEMORY_USAGE) ?? "{}") as Record<string, number>
  }

  /** The life summaries still to make, a few per alarm. */
  private async armNaps(): Promise<void> {
    if (this.life.pending(1).length) await this.alarms.setWakeup(LIFE_WAKEUP, Date.now() + 2_000)
  }

  private async napLife(): Promise<void> {
    for (const span of this.life.pending(NAPS_PER_ALARM)) {
      const prompt = this.life.prompt(span)
      if (!prompt) continue
      const out = await this.compress(prompt)
      if ("retryAt" in out) return void (await this.alarms.setWakeup(LIFE_WAKEUP, out.retryAt))
      if ("error" in out && this.life.tree.failed(span) < MAX_NAP_FAILS) throw new Error(out.error)
      this.life.settle(span, "text" in out ? out.text : null)
    }
    await this.armNaps()
  }

  #compressing = 0

  /**
   * One memory summary with the human's memory model and their own credential. Rooms call it for their
   * own summaries, so keys never leave this object. At most `MAX_NAPS` at once per user, so a dozen
   * busy chats cannot spend the human's rate limit: the rest are told when to try again.
   */
  async compress(prompt: string): Promise<{ text: string } | { retryAt: number } | { error: string }> {
    if (this.#compressing >= MAX_NAPS) return { retryAt: Date.now() + 5_000 + Math.floor(Math.random() * 5_000) }
    this.#compressing++
    try {
      const answer = await this.complete(this.memoryModel() ?? DEFAULT_MODEL, NAP_SYSTEM, prompt)
      if (answer === null) return { retryAt: Date.now() + 10 * 60_000 }
      const line = cleanLine(answer)
      return line ? { text: line } : { error: "the model wrote no line" }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    } finally {
      this.#compressing--
    }
  }

  /**
   * One completion with `model` and the user's own credential. Null when the user has no credential
   * for that provider. Kiko pays for no model.
   */
  private async complete(ref: { provider: string; modelId: string }, system: string, prompt: string): Promise<string | null> {
    const { provider, modelId } = ref
    const auth = (await this.turnContext(provider)).auth
    if (!auth) return null
    const { models, settings } = userModels(async () => auth, `memory-${this.ctx.id.toString()}`)
    const model = models.getModel(provider, modelId)
    if (!model) return null
    const headers = (settings as { stream?: { headers?: Record<string, string> } }).stream?.headers
    const reply = await models.completeSimple(
      model,
      { systemPrompt: system, messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
      // A summary that hangs would hold its room's pass forever, so each call has a deadline. A summary is
      // an easy task, so it asks for no thinking: none where the model can turn it off, the least where not.
      { headers, signal: AbortSignal.timeout(COMPRESS_TIMEOUT_MS), ...(model.reasoning && model.thinkingLevelMap?.off === null ? { reasoning: "minimal" as const } : {}) },
    )
    // The provider's own words, cut short: they name the cause (a timeout, a refusal) and carry no key.
    // What memory costs, for the memory screen and `verify token-cost`: one row, summed.
    const spent = JSON.parse(this.setting(MEMORY_USAGE) ?? "{}") as Record<string, number>
    for (const k of ["input", "output", "cacheRead"] as const) spent[k] = (spent[k] ?? 0) + (reply.usage?.[k] ?? 0)
    spent.calls = (spent.calls ?? 0) + 1
    this.putSetting(MEMORY_USAGE, JSON.stringify(spent))
    if (reply.stopReason === "error" || reply.stopReason === "aborted") throw new Error(`the model call failed: ${reply.stopReason} ${(reply.errorMessage ?? "").slice(0, 160)}`)
    return reply.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("")
  }

  // Provider credentials (P4-01). No method returns a secret.
  // DEVIATION: the plan names these `connect` and `disconnect`, but `connect` is the
  // `DurableObject` handler for incoming TCP sockets, so they carry a `Provider` suffix.

  async connectProvider(provider: string, apiKey: string): Promise<ProviderInfo> {
    return this.#credentials.connect(provider, apiKey)
  }

  async disconnectProvider(provider: string): Promise<boolean> {
    return this.#credentials.disconnect(provider)
  }

  async listProviders(): Promise<ProviderInfo[]> {
    return this.#credentials.listProviders()
  }

  /** The plan record (P9-01). */
  limits(): Limits {
    const raw = this.sql.exec<{ value: string }>("SELECT value FROM settings WHERE key = 'limits'").toArray()[0]?.value
    return resolveLimits(raw ? (JSON.parse(raw) as Partial<Limits>) : null)
  }

  /** Admin and dev only: replaces fields of the plan record. The Worker's admin route checks who asks. */
  setLimits(patch: Partial<Limits>): Limits {
    const next = { ...JSON.parse(this.sql.exec<{ value: string }>("SELECT value FROM settings WHERE key = 'limits'").toArray()[0]?.value ?? "{}"), ...patch }
    this.sql.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('limits', ?)", JSON.stringify(next))
    return this.limits()
  }

  /** The room asks once per human burst (P9-01). Counts the turn when it is allowed. */
  /**
   * Section 25.5. A room asks before it starts a run nobody asked for in the moment. Held while the
   * human has been away `awayDays`, and past the day's `autonomousRunsPerDay` across every chat.
   */
  takeAutonomous(): AutonomousAnswer {
    const now = Date.now()
    const key = `autonomous:${utcDay(now)}`
    const used = Number(this.setting(key) ?? 0)
    const lastSeen = this.setting(LAST_SEEN)
    const answer = takeAutonomous(used, lastSeen === null ? null : Number(lastSeen), this.limits(), now)
    if (answer.ok) this.putSetting(key, String(answer.used))
    else if (answer.reason === "away") this.ctx.waitUntil(this.awayNotice(now).catch(() => {}))
    return answer
  }

  /** Stamps the last time the human opened kiko, at most once an hour, so a long session costs no writes. */
  private seen(): void {
    const now = Date.now()
    const last = Number(this.setting(LAST_SEEN) ?? 0)
    const wasAway = last > 0 && now - last > this.limits().awayDays * 86_400_000
    if (now - last < 3_600_000) return
    this.putSetting(LAST_SEEN, String(now))
    if (wasAway) this.sql.exec("DELETE FROM settings WHERE key = ?", AWAY_NOTICE)
  }

  /** One line in the kiko chat per time away, so the human knows why nothing ran. */
  private async awayNotice(now: number): Promise<void> {
    if (this.setting(AWAY_NOTICE) !== null) return
    this.putSetting(AWAY_NOTICE, String(now))
    const roomId = kikoChatRoom(this.sql)
    const owner = userIdFromObjectName(this.ctx.id.name)
    if (roomId) await roomStub(this.env.ROOM, owner, roomId).systemNotice(`away:${now}`, "i paused your routines and check-ins while you were away. they start again when you open kiko.")
  }

  takeTurn(): TurnAnswer {
    const now = Date.now()
    const key = `turns:${utcDay(now)}`
    const used = Number(this.sql.exec<{ value: string }>("SELECT value FROM settings WHERE key = ?", key).toArray()[0]?.value ?? 0)
    const answer = takeTurn(used, this.limits(), now)
    if (answer.ok) this.sql.exec("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", key, String(answer.used))
    return answer
  }

  /**
   * Architecture section 11.3. Only an `AgentDO` of this user calls it, once at the start of a run.
   * The answer holds the request auth, so the Worker's HTTP layer never calls it.
   */
  async turnContext(provider: string): Promise<TurnContext> {
    const setting = (key: string) =>
      this.sql.exec<{ value: string }>("SELECT value FROM settings WHERE key = ?", key).toArray()[0]?.value ?? null
    const limits = setting("limits")
    return resolveTurnContext(this.#credentials, provider, { timezone: setting("timezone"), limits: limits ? JSON.parse(limits) : null }, this.life.view(Date.now()))
  }

  // pi-ai's `CredentialStore` for this user. A `#` member, so RPC can never reach it.
  #vault?: CredentialVault
  get #credentials(): CredentialVault {
    this.#vault ??= new CredentialVault(this.sql, keyringFromEnv(this.env), userIdFromObjectName(this.ctx.id.name))
    return this.#vault
  }

  // Executor Cloud (P7-03, architecture section 12.1). The tokens live in this object,
  // sealed, and every exchange and refresh runs here.

  /** The Worker calls this from the OAuth callback. Every socket hears the result. */
  async finishExecutor(params: CallbackParams): Promise<ExecutorResult> {
    const result = await this.executorResult(async () => ({ status: await this.#executor.finish(params) }))
    this.broadcast({ t: "executor", result })
    return result
  }

  /**
   * A fresh Executor bearer credential for this user's own agents, or null. Server code
   * only: it is never sent on a socket or over HTTP.
   */
  /** The tools Executor offers this user, for an agent's run (P7-04). Null when it is not connected. */
  async executorTools(): Promise<ExecutorTool[] | null> {
    if (!(await this.#executor.status()).connected) return null
    return this.#executor.tools()
  }

  /** Calls one Executor tool for this user's agent. The credential never leaves this object. */
  async executorCall(name: string, args: Record<string, unknown>) {
    return this.#executor.call(name, args)
  }

  async executorToken(): Promise<string | null> {
    return this.#executor.bearer()
  }

  #executorConnection?: ExecutorConnection
  get #executor(): ExecutorConnection {
    this.#executorConnection ??= new ExecutorConnection(
      new ExecutorTokenStore(this.sql, keyringFromEnv(this.env), userIdFromObjectName(this.ctx.id.name), (fn) =>
        this.ctx.storage.transactionSync(fn),
      ),
    )
    return this.#executorConnection
  }

  private async executorResult(
    run: () => Promise<{ status?: ExecutorStatus; authorizeUrl?: string; tools?: string[] }>,
  ): Promise<ExecutorResult> {
    try {
      const { status, ...rest } = await run()
      return { ok: true, status: status ?? (await this.#executor.status()), ...rest }
    } catch (e) {
      return { ok: false, error: errorText(e) }
    }
  }

  private async executorFrame(ws: WebSocket, frame: Extract<UserFrame, { t: "connectExecutor" | "disconnectExecutor" | "executorStatus" }>) {
    const executor = this.#executor
    const result = await this.executorResult(async () => {
      if (frame.t === "disconnectExecutor") {
        executor.disconnect()
        return {}
      }
      if (frame.t === "connectExecutor") {
        if (frame.apiKey !== undefined) return { status: await executor.connectApiKey(frame.apiKey) }
        const origin = (ws.deserializeAttachment() as Attachment | null)?.origin
        if (!origin) throw new ExecutorError("this socket has no origin")
        return { authorizeUrl: await executor.start(origin) }
      }
      if (frame.refresh) await executor.refresh()
      return frame.tools ? { tools: await executor.listTools() } : {}
    })
    send(ws, { t: "executor", reqId: frame.reqId, result })
  }

  // Provider sign-in (P4-04, architecture 11.4). The logic is in provider-login.ts.
  #loginState?: ProviderLogins<WebSocket>
  get #logins(): ProviderLogins<WebSocket> {
    this.#loginState ??= new ProviderLogins<WebSocket>({
      store: this.#credentials,
      info: (provider) => this.#credentials.listProviders().find((p) => p.provider === provider) ?? null,
      send,
      setWakeup: (key, at) => this.alarms.setWakeup(key, at),
      clearWakeup: (key) => this.alarms.clearWakeup(key),
      subscriptions: this.env.PROVIDER_OAUTH === "on",
      fake: process.env.NODE_ENV === "development",
    })
    return this.#loginState
  }

  // The socket.

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 })
    }
    if (this.#wiped || (await this.ctx.storage.get(DELETING))) return new Response("account deleted", { status: 410 })
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ ready: false, helloBy: helloBy(), origin: new URL(request.url).origin } satisfies Attachment)
    await enforceHello(this.ctx, this.alarms)
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let frame: typeof ClientToUser.Type
    try {
      frame = decodeFrame(JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)))
    } catch {
      return // A frame that breaks the protocol is dropped. Its content is never logged.
    }
    if (frame.t === "hello") {
      this.seen()
      send(ws, this.resume(frame.lastSeq))
      const before = ws.deserializeAttachment() as Attachment | null
      ws.serializeAttachment({ ...before, ready: true } satisfies Attachment)
      return
    }
    if (frame.t === "connectExecutor" || frame.t === "disconnectExecutor" || frame.t === "executorStatus") {
      await this.executorFrame(ws, frame)
      return
    }
    if (frame.t === "memory") {
      send(ws, { t: "memory_result", reqId: frame.reqId, result: await this.memoryCall(frame.op) })
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
      // One row, no event and no broadcast: the client sends it at most every few seconds.
      this.sql.exec("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", LAST_CHAT, frame.roomId)
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
    // A login runs until it ends, so the handler does not wait for it.
    if (frame.t === "login.start") return void this.#logins.start(ws, frame.loginId, frame.provider).catch(() => {})
    if (frame.t === "login.answer") return this.#logins.answer(ws, frame.loginId, frame.promptId, frame.value)
    if (frame.t === "login.cancel") return this.#logins.cancel(ws, frame.loginId)
    // One direct chat per agent. The client looks first; a client that did not know is told which chat it is.
    const existing = this.duplicateOf(frame.op)
    if (existing) return send(ws, { t: "chat_refused", roomId: frame.op.roomId, existing })
    this.apply(frame.op)
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.#loginState?.dropOwner(ws)
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.#loginState?.dropOwner(ws)
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code)
    } catch {
      // already closed
    }
  }

  async alarm(): Promise<void> {
    if (this.#wiped || (await this.ctx.storage.get(DELETING))) return
    const due = await this.alarms.dueWakeups(Date.now())
    await runDue(this.alarms, due, {
      [HELLO_WAKEUP]: () => enforceHello(this.ctx, this.alarms),
      [REMINDERS_WAKEUP]: () => this.reminders.fire(),
      [LIFE_WAKEUP]: () => this.napLife(),
    })
    this.#loginState?.expire(due)
  }

  /**
   * The Worker calls this before it addresses one of the user's rooms, so deletion can
   * find a room that never became a chat. False once deletion has begun.
   */
  async recordRoom(roomId: RoomId): Promise<boolean> {
    if (this.#wiped || (await this.ctx.storage.get(DELETING))) return false
    this.sql.exec("INSERT OR IGNORE INTO rooms (room_id) VALUES (?)", roomId)
    return true
  }

  // Account deletion (P9-02). The account route starts it and the jobs in
  // jobs/delete-account.ts report each room back. This object is deleted last but one,
  // before the D1 rows.
  #wiped = false

  /**
   * Marks the account as being deleted, stops reminders, and records every room in a
   * ledger. Returns the rooms still to delete. Safe to call again.
   */
  async beginDeletion(): Promise<RoomId[]> {
    if (this.#wiped) return []
    await this.ctx.storage.put(DELETING, Date.now())
    await this.ctx.storage.deleteAlarm()
    closeSockets(this.ctx)
    this.sql.exec("CREATE TABLE IF NOT EXISTS deletion_rooms (room_id TEXT PRIMARY KEY)")
    // Chats and every room ever addressed. A deleted chat's room is still in `rooms`.
    this.sql.exec("INSERT OR IGNORE INTO deletion_rooms (room_id) SELECT room_id FROM chats UNION SELECT room_id FROM rooms")
    return this.sql.exec<{ room_id: RoomId }>("SELECT room_id FROM deletion_rooms ORDER BY room_id").toArray().map((r) => r.room_id)
  }

  /** A room job reports its room gone. Returns how many rooms remain. 0 also when nothing is recorded. */
  async roomDeleted(roomId: RoomId): Promise<number> {
    if (this.#wiped) return 0
    this.sql.exec("CREATE TABLE IF NOT EXISTS deletion_rooms (room_id TEXT PRIMARY KEY)")
    this.sql.exec("DELETE FROM deletion_rooms WHERE room_id = ?", roomId)
    return this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM deletion_rooms").one().n
  }

  /** Deletes all of this user's storage. Returns the rows that held data, 0 on a repeat. */
  async deleteAll(): Promise<number> {
    if (this.#wiped) return 0
    const rows = await wipeStorage(this.ctx)
    this.#wiped = true
    return rows
  }

  async storedRows(): Promise<number> {
    return this.#wiped ? 0 : storedRows(this.ctx.storage)
  }

  // Internals.

  private apply(op: ChatOp): UserEvent | null {
    // The kiko chat stays pinned: a delete or unpin of it changes nothing, like a delete of a chat that is gone.
    if (movesKikoChat(this.sql, op) || this.duplicateOf(op)) return null
    const event = this.commit(applyChatOp(this.sql, op, Date.now()))
    // The room tells its agents on every delivery, so it hears of the change now, not at the next burst.
    if (event && op.op === "private") {
      const room = roomStub(this.env.ROOM, userIdFromObjectName(this.ctx.id.name), op.roomId)
      this.ctx.waitUntil(Promise.resolve(room.setPrivate(op.private)).catch((e: unknown) => console.error(`private flag not sent: ${e instanceof Error ? e.message : String(e)}`)))
    }
    return event
  }

  /** The agent's one direct chat when `op` would make a second one, else null. */
  private duplicateOf(op: ChatOp): RoomId | null {
    if (op.op !== "create" || op.temp || op.agents?.length !== 1) return null
    return duplicateDm(listChats(this.sql).map((c) => markKikoChat(this.sql, c)), op)
  }

  /** The chat a new device opens: the last one the user was in, else the kiko chat. Never a temporary chat. */
  private lastChat(): RoomId | undefined {
    const stored = this.sql.exec<{ value: string }>("SELECT value FROM settings WHERE key = ?", LAST_CHAT).toArray()[0]?.value
    const chat = stored ? getChat(this.sql, stored) : null
    return chat && !chat.temp ? chat.roomId : (kikoChatRoom(this.sql) ?? undefined)
  }

  /** RPC. Makes sure the kiko chat exists. Safe to call on every sign-in and page load. */
  async ensureHome(): Promise<void> {
    for (const op of kikoChatOps(this.sql, (roomId) => getChat(this.sql, roomId) !== null)) this.apply(op)
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

  /** Stores `change` as the next event and sends it to every socket that said hello. */
  private commit(change: ChatChange | { t: "agent"; agent: Agent } | { t: "theme"; theme: string | null } | FileBody | ExtensionEvent | null): UserEvent | null {
    if (!change) return null
    // The kiko chat carries its flag on every event, so a client never offers to delete it.
    if (change.t === "chat") change = { ...change, chat: markKikoChat(this.sql, change.chat) }
    const at = Date.now()
    const seq = this.currentSeq() + 1
    const event = { ...change, seq, at } as UserEvent
    this.sql.exec("INSERT INTO user_events (seq, at, body) VALUES (?, ?, ?)", seq, at, JSON.stringify(event))
    this.sql.exec("DELETE FROM user_events WHERE seq <= ?", seq - REPLAY_LIMIT)
    if (this.holding) this.holding.push(event)
    else this.broadcast({ t: "events", events: [event] })
    return event
  }

  /** Sends a frame to every socket that has said hello. */
  private broadcast(frame: UserToClient): void {
    const text = JSON.stringify(frame)
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() as Attachment | null)?.ready) trySend(ws, text)
    }
  }

  /**
   * The answer to `hello`: the events after `lastSeq`, or a snapshot when they are gone. A client
   * with nothing (`lastSeq` 0) always gets the snapshot: it is one row per chat and agent while the
   * replay grows by one event per run, and only the snapshot says which chat to open (`lastChat`).
   */
  private resume(lastSeq: number): UserToClient {
    const seq = this.currentSeq()
    const { oldest } = this.sql.exec<{ oldest: number | null }>("SELECT min(seq) AS oldest FROM user_events").one()
    const replayable = lastSeq > 0 && lastSeq <= seq && (oldest === null || lastSeq >= oldest - 1)
    if (!replayable) {
      const lastChat = this.lastChat()
      return {
        t: "reset",
        snapshot: { seq, chats: listChats(this.sql).map((c) => markKikoChat(this.sql, c)), agents: listAgents(this.sql), theme: getTheme(this.sql), home: { files: this.home.all(), folders: this.home.folders() }, ...(lastChat ? { lastChat } : {}), extensions: this.extensions.list(), proposals: this.extensions.proposals() },
      }
    }
    const events = this.sql
      .exec<{ body: string }>("SELECT body FROM user_events WHERE seq > ? ORDER BY seq", lastSeq)
      .toArray()
      .map((r) => JSON.parse(r.body) as UserEvent)
    return { t: "events", events }
  }
}

function send(ws: WebSocket, frame: UserToClient): void {
  trySend(ws, JSON.stringify(frame))
}

function trySend(ws: WebSocket, text: string): void {
  try {
    ws.send(text)
  } catch {
    // The socket closed between the list and the send. It resumes on reconnect.
  }
}
