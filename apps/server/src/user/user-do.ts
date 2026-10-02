import type { Agent, Chat, ChatOp, ClientToUser as UserFrame, ExecutorResult, ExecutorStatus, MemoryOp, MemoryResult, RoomId, UserEvent, UserToClient } from "@kiko/protocol"
import { ClientToUser } from "@kiko/protocol/schema"
import { DurableObject } from "cloudflare:workers"
import { Schema } from "effect"
import type { Env } from "../index"
import { type CallbackParams, errorText, ExecutorConnection, ExecutorError } from "../integrations/executor/connect"
import { ExecutorTokenStore } from "../integrations/executor/token-store"
import { type Alarms, createAlarms } from "../lib/alarm"
import { enforceHello, HELLO_WAKEUP, helloBy } from "../lib/hello-deadline"
import { keyringFromEnv } from "../lib/crypto"
import { CredentialVault, type ProviderInfo, userIdFromObjectName } from "./credentials"
import { createAgent, listAgents } from "./agents"
import { applyChatOp, type ChatChange, getChat, listChats, searchChats, type Touch, touchChat } from "./chats"
import { createMemory, type MemoryStore } from "./memory"
import { ProviderLogins } from "./provider-login"
import { asResult, type NewReminder, REMINDERS_WAKEUP, Reminders, roomDelivery } from "./reminders"
import { migrate } from "./schema"
import { getTheme, setTheme } from "./theme"
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
    this.sql = ctx.storage.sql
    // Architecture section 23: the schema migration runs before any other work on every start.
    void ctx.blockConcurrencyWhile(async () => {
      migrate(this.sql)
      this.alarms = createAlarms(ctx)
      this.memory = createMemory(this.sql, (fn) => ctx.storage.transactionSync(fn))
      this.reminders = new Reminders(this.sql, this.alarms, roomDelivery(env, () => this.reminders.owner()))
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
    return this.commit(touchChat(this.sql, roomId, touch, Date.now())) !== null
  }

  async searchChats(query: string): Promise<Chat[]> {
    return searchChats(this.sql, query)
  }

  async listChats(): Promise<Chat[]> {
    return listChats(this.sql)
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
    return this.memory.handle(op)
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
      send(ws, { t: "memory_result", reqId: frame.reqId, result: this.memory.handle(frame.op) })
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
    return this.commit(applyChatOp(this.sql, op, Date.now()))
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
    const at = Date.now()
    const seq = this.currentSeq() + 1
    const event = { ...change, seq, at } as UserEvent
    this.sql.exec("INSERT INTO user_events (seq, at, body) VALUES (?, ?, ?)", seq, at, JSON.stringify(event))
    this.sql.exec("DELETE FROM user_events WHERE seq <= ?", seq - REPLAY_LIMIT)
    this.broadcast({ t: "events", events: [event] })
    return event
  }

  /** Sends a frame to every socket that has said hello. */
  private broadcast(frame: UserToClient): void {
    const text = JSON.stringify(frame)
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() as Attachment | null)?.ready) trySend(ws, text)
    }
  }

  /** The answer to `hello`: the events after `lastSeq`, or a snapshot when they are gone. */
  private resume(lastSeq: number): UserToClient {
    const seq = this.currentSeq()
    const oldest = this.sql.exec<{ seq: number | null }>("SELECT min(seq) AS seq FROM user_events").one().seq
    const replayable = lastSeq <= seq && (oldest === null || lastSeq >= oldest - 1)
    if (!replayable) return { t: "reset", snapshot: { seq, chats: listChats(this.sql), agents: listAgents(this.sql), theme: getTheme(this.sql) } }
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
