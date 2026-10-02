import type { Chat, ChatOp, RoomId } from "@kiko/protocol"

// The chat index. Every edit is a pure step over one row: it returns the change to
// broadcast, or null when the row already says the same thing. A repeated or late
// edit therefore stores and sends nothing, which makes every caller safe to retry.

const MAX_TITLE = 200
const MAX_PREVIEW = 280

type Row = {
  room_id: string
  title: string
  pinned: number
  muted: number
  last_seq: number
  last_preview: string
  unread: number
  updated_at: number
}

/** What a room reports once at the end of a run. */
export type Touch = {
  /** The room's sequence after the run. A touch at or below the stored one is ignored. */
  lastSeq: number
  lastPreview: string
  /** Messages the human has not read, counted by the room. */
  unread: number
}

export type ChatChange = { t: "chat"; chat: Chat } | { t: "chat_removed"; roomId: RoomId }

const clip = (text: string, max: number) => text.trim().slice(0, max)

function toChat(row: Row): Chat {
  return {
    roomId: row.room_id as RoomId,
    title: row.title,
    pinned: row.pinned === 1,
    muted: row.muted === 1,
    lastSeq: row.last_seq,
    lastPreview: row.last_preview,
    unread: row.unread,
    updatedAt: row.updated_at,
  }
}

export function getChat(sql: SqlStorage, roomId: string): Chat | null {
  const row = sql.exec<Row>("SELECT * FROM chats WHERE room_id = ?", roomId).toArray()[0]
  return row ? toChat(row) : null
}

/** Pinned chats first, then the most recently active. */
export function listChats(sql: SqlStorage): Chat[] {
  return sql.exec<Row>("SELECT * FROM chats ORDER BY pinned DESC, updated_at DESC, room_id").toArray().map(toChat)
}

function write(sql: SqlStorage, chat: Chat): ChatChange {
  sql.exec(
    `INSERT INTO chats (room_id, title, pinned, muted, last_seq, last_preview, unread, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(room_id) DO UPDATE SET title = excluded.title, pinned = excluded.pinned, muted = excluded.muted,
       last_seq = excluded.last_seq, last_preview = excluded.last_preview, unread = excluded.unread,
       updated_at = excluded.updated_at`,
    chat.roomId,
    chat.title,
    chat.pinned ? 1 : 0,
    chat.muted ? 1 : 0,
    chat.lastSeq,
    chat.lastPreview,
    chat.unread,
    chat.updatedAt,
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
      }
    case "rename": {
      const title = clip(op.title, MAX_TITLE)
      return current && current.title !== title ? { ...current, title } : null
    }
    case "pin":
      return current && current.pinned !== op.pinned ? { ...current, pinned: op.pinned } : null
    case "mute":
      return current && current.muted !== op.muted ? { ...current, muted: op.muted } : null
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

/**
 * Records the end of a run. A touch for an unknown or deleted chat is ignored, so a
 * late touch cannot bring a deleted chat back. A touch with a `lastSeq` the row already
 * has is a repeat and is ignored too.
 */
export function touchChat(sql: SqlStorage, roomId: string, touch: Touch, now: number): ChatChange | null {
  const current = getChat(sql, roomId)
  if (!current || touch.lastSeq <= current.lastSeq) return null
  return write(sql, {
    ...current,
    lastSeq: touch.lastSeq,
    lastPreview: clip(touch.lastPreview, MAX_PREVIEW),
    unread: Math.max(0, Math.floor(touch.unread)),
    updatedAt: now,
  })
}
