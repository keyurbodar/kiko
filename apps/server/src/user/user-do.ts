import type { Agent, Chat, ChatOp, ClientToUser as UserFrame, ExecutorResult, ExecutorStatus, MemoryOp, MemoryResult, RoomId, UserEvent, UserToClient } from "@kiko/protocol"
import { ClientToUser } from "@kiko/protocol/schema"
import { DurableObject } from "cloudflare:workers"
import { instrument } from "../lib/dev-stats"
import { Schema } from "effect"
import type { Env } from "../index"
import { type CallbackParams, errorText, ExecutorConnection, ExecutorError } from "../integrations/executor/connect"
import { ExecutorTokenStore } from "../integrations/executor/token-store"
import { type Limits, resolveLimits, takeTurn, type TurnAnswer, utcDay } from "./limits"
import type { ExecutorTool } from "../integrations/executor/tools"
import { type Alarms, createAlarms } from "../lib/alarm"
import { enforceHello, HELLO_WAKEUP, helloBy } from "../lib/hello-deadline"
import { deletesHome, homeOps, markHome } from "./home"
import { keyringFromEnv } from "../lib/crypto"
import { CredentialVault, type ProviderInfo, userIdFromObjectName } from "./credentials"
import { createAgent, listAgents } from "./agents"
import { applyChatOp, type ChatChange, getChat, listChats, searchChats, type Touch, touchChat } from "./chats"
import { createMemory, type MemoryStore } from "./memory"
import { ProviderLogins } from "./provider-login"
import { asResult, type NewReminder, REMINDERS_WAKEUP, Reminders, roomDelivery } from "./reminders"
import { migrate } from "./schema"
import { DEFAULT_TIMEZONE, resolveTurnContext, type TurnContext } from "./turn-context"
import { getTheme, setTheme } from "./theme"
import { nextTidyAt, TIDY_WAKEUP, Tidy, type TidyReport } from "./tidy"
import { DEFAULT_MODEL, userModels } from "../agent/factory"
import { roomStub } from "../lib/names"
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

/** The storage key that marks an account deletion in progress. */
const DELETING = "deleting"

export class UserDO extends DurableObject<Env> {
  private readonly sql: SqlStorage
  // Reminders and the memory tidy register wakeups here in their own tasks.
  // Set in the constructor's `blockConcurrencyWhile`, which ends before any request or alarm runs.
  private alarms!: Alarms
  private memory!: MemoryStore

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
      this.memory = createMemory(this.sql, (fn) => ctx.storage.transactionSync(fn))
      this.reminders = new Reminders(this.sql, this.alarms, roomDelivery(env, () => this.reminders.owner()))
      this.tidy = new Tidy({
        sql: this.sql,
        memory: this.memory,
        now: Date.now,
        chats: () => listChats(this.sql),
        readChat: (roomId, since, limit) => roomStub(env.ROOM, userIdFromObjectName(ctx.id.name), roomId).humanMessagesSince(since, limit),
        complete: (system, prompt) => this.completeDefault(system, prompt),
      })
    })
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

  /** Adds a chat. A repeat for the same room changes nothing and returns the stored row. */
  async createChat(roomId: RoomId, title: string, agents?: readonly string[]): Promise<Chat> {
    this.apply({ op: "create", roomId, title, ...(agents?.length ? { agents } : {}) })
    return getChat(this.sql, roomId)!
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
   * A room calls this once at the end of a run. Returns true when it changed the row
   * and broadcast. A repeat with the same `lastSeq` returns false and sends nothing.
   */
  async touchChat(roomId: RoomId, touch: Touch): Promise<boolean> {
    const changed = this.commit(touchChat(this.sql, roomId, touch, Date.now())) !== null
    if (changed) await this.armTidy()
    return changed
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

  /** The theme JSON text, or null. */
  async getTheme(): Promise<string | null> {
    return getTheme(this.sql)
  }

  /** Saves or clears the theme and tells every socket. Returns false when it changed nothing. */
  async setTheme(theme: string | null): Promise<boolean> {
    return this.saveTheme(theme)
  }

  /** Memory. One RPC for every operation, the same one the socket uses. Never throws on a bad id. */
  async memoryOp(op: MemoryOp): Promise<MemoryResult> {
    return this.memoryCall(op)
  }

  // The daily memory tidy (P5-03, architecture section 13.3). The logic is in tidy.ts.
  private tidy!: Tidy

  /** Runs the tidy now. `kiko memory tidy --now` and the alarm both come here. */
  async tidyMemory(): Promise<TidyReport> {
    return this.tidy.run()
  }

  /** A memory write arms the next tidy. Reads arm nothing. */
  private async memoryCall(op: MemoryOp): Promise<MemoryResult> {
    const result = this.memory.handle(op)
    if (result.ok && !["list", "search", "view", "history"].includes(op.op)) await this.armTidy()
    return result
  }

  /** Sets the tidy wakeup for the next 03:00 in the user's timezone, unless one is already set. */
  private async armTidy(): Promise<void> {
    if (this.sql.exec("SELECT 1 FROM wakeups WHERE key = ?", TIDY_WAKEUP).toArray().length) return
    const tz = this.sql.exec<{ value: string }>("SELECT value FROM settings WHERE key = 'timezone'").toArray()[0]?.value
    await this.alarms.setWakeup(TIDY_WAKEUP, nextTidyAt(tz ?? DEFAULT_TIMEZONE, Date.now()))
  }

  /**
   * One completion with the user's default model and the user's own credential, for the tidy.
   * Null when the user has no credential for that provider. Kiko pays for no model.
   */
  private async completeDefault(system: string, prompt: string): Promise<string | null> {
    const { provider, modelId } = DEFAULT_MODEL
    const auth = (await this.turnContext(provider)).auth
    if (!auth) return null
    const { models, settings } = userModels(async () => auth, `tidy-${this.ctx.id.toString()}`)
    const model = models.getModel(provider, modelId)
    if (!model) return null
    const headers = (settings as { stream?: { headers?: Record<string, string> } }).stream?.headers
    const reply = await models.completeSimple(
      model,
      { systemPrompt: system, messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
      { headers },
    )
    if (reply.stopReason === "error" || reply.stopReason === "aborted") throw new Error("the model call failed")
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
    const body = (id: string) => this.memory.peek(id)?.body ?? ""
    const memory = { profile: body("profile"), now: body("now"), todo: body("todo") }
    return resolveTurnContext(this.#credentials, provider, { timezone: setting("timezone"), limits: limits ? JSON.parse(limits) : null }, memory)
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
    // A login runs until it ends, so the handler does not wait for it.
    if (frame.t === "login.start") return void this.#logins.start(ws, frame.loginId, frame.provider).catch(() => {})
    if (frame.t === "login.answer") return this.#logins.answer(ws, frame.loginId, frame.promptId, frame.value)
    if (frame.t === "login.cancel") return this.#logins.cancel(ws, frame.loginId)
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
    if (due.includes(HELLO_WAKEUP)) await enforceHello(this.ctx, this.alarms)
    if (due.includes(REMINDERS_WAKEUP)) await this.reminders.fire()
    if (due.includes(TIDY_WAKEUP)) await this.tidy.run()
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
    // The kiko chat stays: a delete of it changes nothing, like a delete of a chat that is gone.
    if (deletesHome(this.sql, op)) return null
    return this.commit(applyChatOp(this.sql, op, Date.now()))
  }

  /** RPC. Makes sure the kiko chat exists. Safe to call on every sign-in and page load. */
  async ensureHome(): Promise<void> {
    for (const op of homeOps(this.sql, (roomId) => getChat(this.sql, roomId) !== null)) this.apply(op)
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
  private commit(change: ChatChange | { t: "agent"; agent: Agent } | { t: "theme"; theme: string | null } | null): UserEvent | null {
    if (!change) return null
    // The kiko chat carries its flag on every event, so a client never offers to delete it.
    if (change.t === "chat") change = { ...change, chat: markHome(this.sql, change.chat) }
    const at = Date.now()
    const seq = this.currentSeq() + 1
    const event = { ...change, seq, at } as UserEvent
    this.sql.exec("INSERT INTO user_events (seq, at, body) VALUES (?, ?, ?)", seq, at, JSON.stringify(event))
    this.sql.exec("DELETE FROM user_events WHERE seq <= ?", seq - REPLAY_LIMIT)
    this.broadcast({ t: "events", events: [event] })
    return event
  }

  /** Rows a snapshot carries: every chat and agent, and the theme. */
  private snapshotRows(): number {
    return this.sql.exec<{ n: number }>("SELECT (SELECT count(*) FROM chats) + (SELECT count(*) FROM agents) + 1 AS n").one().n
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
   * with nothing (`lastSeq` 0) also gets the snapshot when it is shorter: every run touches a chat
   * and stores one more event, so the replay grows to 500 events while the snapshot is one row per
   * chat and agent.
   */
  private resume(lastSeq: number): UserToClient {
    const seq = this.currentSeq()
    const { oldest, stored } = this.sql
      .exec<{ oldest: number | null; stored: number }>("SELECT min(seq) AS oldest, count(*) AS stored FROM user_events")
      .one()
    const replayable = lastSeq <= seq && (oldest === null || lastSeq >= oldest - 1)
    const fresher = lastSeq === 0 && stored > this.snapshotRows()
    if (!replayable || fresher) return { t: "reset", snapshot: { seq, chats: listChats(this.sql).map((c) => markHome(this.sql, c)), agents: listAgents(this.sql), theme: getTheme(this.sql) } }
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
