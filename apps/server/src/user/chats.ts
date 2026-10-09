import type { Chat, ChatLast, ChatOp, RoomId } from "@yuki/protocol"

// The chat index. Every edit is a pure step over one row: it returns the change to
// broadcast, or null when the row already says the same thing. A repeated or late
// edit therefore stores and sends nothing, which makes every caller safe to retry.

const MAX_TITLE = 200
const MAX_PREVIEW = 280
const MAX_AGENTS = 20

type Row = {
  room_id: string
  title: string
  pinned: number
  muted: number
  last_seq: number
  last_preview: string
  unread: number
  updated_at: number
  agents: string
  private: number
  /** "temp" for a temporary chat. Older rows hold the draft kind, "ask" or "group", and are temporary too. */
  draft: string | null
  last: string | null
  mentions: number
  grp: number
}

/** What a room reports when its newest activity, its read position, or its members change. */
export type Touch = {
  /** The room's sequence now. A touch at or below the stored one is ignored. */
  lastSeq: number
  lastPreview: string
  /** Messages the human has not read, counted by the room. */
  unread: number
  /** The newest activity. Absent from a room that predates it. */
  last?: ChatLast
  /** Unread agent messages that mention the human or reply to them. */
  mentions?: number
  group?: boolean
}

export type ChatChange = { t: "chat"; chat: Chat } | { t: "chat_removed"; roomId: RoomId }

const clip = (text: string, max: number) => text.trim().slice(0, max)

function toChat(row: Row): Chat {
  const agents = JSON.parse(row.agents || "[]") as string[]
  return {
    ...(agents.length ? { agents } : {}),
    roomId: row.room_id as RoomId,
    title: row.title,
    pinned: row.pinned === 1,
    muted: row.muted === 1,
    lastSeq: row.last_seq,
    lastPreview: row.last_preview,
    unread: row.unread,
    updatedAt: row.updated_at,
    ...(row.private === 1 ? { private: true } : {}),
    ...(row.draft !== null ? { temp: true as const } : {}),
    ...(row.last ? { last: JSON.parse(row.last) as ChatLast } : {}),
    ...(row.mentions > 0 ? { mentions: row.mentions } : {}),
    ...(row.grp === 1 ? { group: true as const } : {}),
  }
}

export function getChat(sql: SqlStorage, roomId: string): Chat | null {
  const row = sql.exec<Row>("SELECT * FROM chats WHERE room_id = ?", roomId).toArray()[0]
  return row ? toChat(row) : null
}

/** Chats whose title contains every word of `query`, case folded. Pinned first, then most recent. */
export function searchChats(sql: SqlStorage, query: string): Chat[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)
  if (!words.length) return []
  const where = ["draft IS NULL", ...words.map(() => "instr(lower(title), ?) > 0")].join(" AND ")
  return sql
    .exec<Row>(`SELECT * FROM chats WHERE ${where} ORDER BY pinned DESC, updated_at DESC, room_id LIMIT 50`, ...words)
    .toArray()
    .map(toChat)
}

/** Pinned chats first, then the most recently active. */
export function listChats(sql: SqlStorage): Chat[] {
  return sql.exec<Row>("SELECT * FROM chats ORDER BY pinned DESC, updated_at DESC, room_id").toArray().map(toChat)
}

function write(sql: SqlStorage, chat: Chat): ChatChange {
  sql.exec(
    `INSERT INTO chats (room_id, title, pinned, muted, last_seq, last_preview, unread, updated_at, agents, private, draft, last, mentions, grp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(room_id) DO UPDATE SET title = excluded.title, pinned = excluded.pinned, muted = excluded.muted,
       last_seq = excluded.last_seq, last_preview = excluded.last_preview, unread = excluded.unread,
       updated_at = excluded.updated_at, agents = excluded.agents, private = excluded.private, draft = excluded.draft,
       last = excluded.last, mentions = excluded.mentions, grp = excluded.grp`,
    chat.roomId,
    chat.title,
    chat.pinned ? 1 : 0,
    chat.muted ? 1 : 0,
    chat.lastSeq,
    chat.lastPreview,
    chat.unread,
    chat.updatedAt,
    JSON.stringify(chat.agents ?? []),
    chat.private ? 1 : 0,
    chat.temp ? "temp" : null,
    chat.last ? JSON.stringify(chat.last) : null,
    chat.mentions ?? 0,
    chat.group ? 1 : 0,
  )
  return { t: "chat", chat }
}

/** The row after `op`, or null when nothing changes. `undefined` means delete. */
function next(current: Chat | null, op: ChatOp, now: number): Chat | null | undefined {
  switch (op.op) {
    case "create":
      if (current) return null
      return {
        roomId: op.roomId,
        title: clip(op.title, MAX_TITLE),
        pinned: false,
        muted: false,
        lastSeq: 0,
        lastPreview: "",
        unread: 0,
        updatedAt: now,
        ...(op.agents?.length ? { agents: op.agents.slice(0, MAX_AGENTS).map((id) => id.slice(0, 64)) } : {}),
        ...(op.temp ? { temp: true as const } : {}),
      }
    case "keep": {
      // Only a temporary chat is kept. It joins the list as a group with its agents.
      if (!current?.temp) return null
      const { temp: _, ...chat } = current
      const agents = op.agents.slice(0, MAX_AGENTS).map((id) => id.slice(0, 64))
      return { ...chat, title: clip(op.title, MAX_TITLE) || current.title, updatedAt: now, ...(agents.length ? { agents } : {}) }
    }
    case "rename": {
      const title = clip(op.title, MAX_TITLE)
      if (!current || current.title === title) return null
      // A renamed group says so in its row, as Telegram does. A DM's title is only a label.
      return current.group ? { ...current, title, last: { from: "human", kind: "renamed", text: title, at: now }, updatedAt: now } : { ...current, title }
    }
    case "pin":
      return current && current.pinned !== op.pinned ? { ...current, pinned: op.pinned } : null
    case "mute":
      return current && current.muted !== op.muted ? { ...current, muted: op.muted } : null
    case "private":
      return current && (current.private ?? false) !== op.private ? { ...current, ...(op.private ? { private: true } : { private: undefined }) } : null
    case "delete":
      return current ? undefined : null
  }
}

/** Applies one chat edit from a client or an RPC. Returns null when it changes nothing. */
export function applyChatOp(sql: SqlStorage, op: ChatOp, now: number): ChatChange | null {
  const current = getChat(sql, op.roomId)
  const chat = next(current, op, now)
  if (chat === null) return null
  if (chat === undefined) {
    sql.exec("DELETE FROM chats WHERE room_id = ?", op.roomId)
    return { t: "chat_removed", roomId: op.roomId }
  }
  return write(sql, chat)
}

/** The row's activity after a touch. A rename is kept until something newer happens in the room. */
function nextLast(current: ChatLast | undefined, touched: ChatLast | undefined): ChatLast | undefined {
  if (current?.kind === "renamed" && (!touched || touched.at < current.at)) return current
  return touched ?? current
}

/**
 * Records a change in the room's newest activity, read position, or members. A touch for an
 * unknown or deleted chat is ignored, so a late touch cannot bring a deleted chat back. A touch
 * with a `lastSeq` the row already has is a repeat or late, and is ignored too.
 *
 * The row sorts by its newest activity, so reading a chat never moves it. A room that predates
 * `last` moves it to now, as before.
 */
export function touchChat(sql: SqlStorage, roomId: string, touch: Touch, now: number): ChatChange | null {
  const current = getChat(sql, roomId)
  if (!current || touch.lastSeq <= current.lastSeq) return null
  const last = nextLast(current.last, touch.last)
  const mentions = Math.max(0, Math.floor(touch.mentions ?? 0))
  const { last: _l, mentions: _m, group: _g, ...rest } = current
  return write(sql, {
    ...rest,
    lastSeq: touch.lastSeq,
    lastPreview: clip(touch.lastPreview, MAX_PREVIEW),
    unread: Math.max(0, Math.floor(touch.unread)),
    updatedAt: touch.last ? Math.max(last?.at ?? 0, current.updatedAt) : now,
    ...(last ? { last } : {}),
    ...(mentions ? { mentions } : {}),
    ...((touch.group ?? current.group) ? { group: true as const } : {}),
  })
}
