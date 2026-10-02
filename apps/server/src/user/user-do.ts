import type { Chat, ChatOp, MemoryOp, MemoryResult, RoomId, UserEvent, UserToClient } from "@kiko/protocol"
import { ClientToUser } from "@kiko/protocol/schema"
import { DurableObject } from "cloudflare:workers"
import { Schema } from "effect"
import type { Env } from "../index"
import { createAlarms } from "../lib/alarm"
import { keyringFromEnv } from "../lib/crypto"
import { CredentialVault, type ProviderInfo, userIdFromObjectName } from "./credentials"
import { applyChatOp, type ChatChange, getChat, listChats, searchChats, type Touch, touchChat } from "./chats"
import { createMemory, type MemoryStore } from "./memory"
import { asResult, type NewReminder, REMINDERS_WAKEUP, Reminders, roomDelivery } from "./reminders"
import { migrate } from "./schema"
import { getTheme, setTheme } from "./theme"

// Architecture sections 4.1 and 9. One object per user. This part owns the chat
// index and the user socket. Every change is stored as an event with a per-user `seq`
// and sent to every socket that has said hello. A client that reconnects sends the
// last `seq` it applied and gets the events after it, or a snapshot when the gap is
// too old to replay.

/** Events kept for replay. An older `lastSeq` gets a snapshot. Same limit as the room. */
const REPLAY_LIMIT = 500

type Attachment = { ready: boolean }

const decodeFrame = Schema.decodeUnknownSync(ClientToUser)

export class UserDO extends DurableObject<Env> {
  private readonly sql: SqlStorage
  // Reminders and the memory tidy register wakeups here in their own tasks.
  private readonly alarms
  private readonly memory: MemoryStore

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    migrate(this.sql)
    this.alarms = createAlarms(ctx)
    this.memory = createMemory(this.sql, (fn) => ctx.storage.transactionSync(fn))
    this.reminders = new Reminders(this.sql, this.alarms, roomDelivery(env, () => this.reminders.owner()))
  }

  // Reminders, architecture section 14. The logic is in reminders.ts. `owner` is the
  // session's user id from the Worker, the one place this object learns it.
  private readonly reminders: Reminders
  async createReminder(owner: string, input: NewReminder) { return asResult(() => this.reminders.create(owner, input)) }
  async listReminders() { return this.reminders.list() }
  async cancelReminder(id: string) { return asResult(() => this.reminders.cancel(id)) }
  async snoozeReminder(id: string, time: string) { return asResult(() => this.reminders.snooze(id, time)) }
  async rewindReminder(id: string) { return asResult(() => this.reminders.rewind(id)) }

  // RPC. The Worker and the user's rooms call these. The object is already the user's
  // own, so no method takes a user id.

  /** Adds a chat. A repeat for the same room changes nothing and returns the stored row. */
  async createChat(roomId: RoomId, title: string): Promise<Chat> {
    this.apply({ op: "create", roomId, title })
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

  // The socket.

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 })
    }
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ ready: false } satisfies Attachment)
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
      ws.serializeAttachment({ ready: true } satisfies Attachment)
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
    this.apply(frame.op)
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code)
    } catch {
      // already closed
    }
  }

  async alarm(): Promise<void> {
    const due = await this.alarms.dueWakeups(Date.now())
    if (due.includes(REMINDERS_WAKEUP)) await this.reminders.fire()
  }

  // Internals.

  private apply(op: ChatOp): UserEvent | null {
    return this.commit(applyChatOp(this.sql, op, Date.now()))
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
  private commit(change: ChatChange | { t: "theme"; theme: string | null } | null): UserEvent | null {
    if (!change) return null
    const at = Date.now()
    const seq = this.currentSeq() + 1
    const event = { ...change, seq, at } as UserEvent
    this.sql.exec("INSERT INTO user_events (seq, at, body) VALUES (?, ?, ?)", seq, at, JSON.stringify(event))
    this.sql.exec("DELETE FROM user_events WHERE seq <= ?", seq - REPLAY_LIMIT)
    const frame = JSON.stringify({ t: "events", events: [event] } satisfies UserToClient)
    for (const ws of this.ctx.getWebSockets()) {
      if ((ws.deserializeAttachment() as Attachment | null)?.ready) trySend(ws, frame)
    }
    return event
  }

  /** The answer to `hello`: the events after `lastSeq`, or a snapshot when they are gone. */
  private resume(lastSeq: number): UserToClient {
    const seq = this.currentSeq()
    const oldest = this.sql.exec<{ seq: number | null }>("SELECT min(seq) AS seq FROM user_events").one().seq
    const replayable = lastSeq <= seq && (oldest === null || lastSeq >= oldest - 1)
    if (!replayable) return { t: "reset", snapshot: { seq, chats: listChats(this.sql), theme: getTheme(this.sql) } }
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
