import type { Chat, ChatLast, ChatOp, RoomId } from "@kiko/protocol"

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
  last: string | null
  mentions: number
  grp: number
  pair: number
}

export type Touch = {
  lastSeq: number
  lastPreview: string
  unread: number
  /** The newest activity. Absent from a room that predates it. */
  last?: ChatLast
  mentions?: number
  group?: boolean
}

export type ChatChange = { t: "chat"; chat: Chat } | { t: "chat_removed"; roomId: RoomId }

const clip = (text: string, max: number) => text.trim().slice(0, max)

function toChat(row: Row): Chat {
  const agents = agentIds(JSON.parse(row.agents || "[]") as string[])
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
    ...(row.last ? { last: JSON.parse(row.last) as ChatLast } : {}),
    ...(row.mentions > 0 ? { mentions: row.mentions } : {}),
    ...(row.grp === 1 ? { group: true as const } : {}),
    ...(row.pair === 1 ? { pair: true as const } : {}),
  }
}

export function getChat(sql: SqlStorage, roomId: string): Chat | null {
  const row = sql.exec<Row>("SELECT * FROM chats WHERE room_id = ?", roomId).toArray()[0]
  return row ? toChat(row) : null
}

export function searchChats(sql: SqlStorage, query: string): Chat[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)
  if (!words.length) return []
  const where = words.map(() => "instr(lower(title), ?) > 0").join(" AND ")
  return sql
    .exec<Row>(`SELECT * FROM chats WHERE pair = 0 AND ${where} ORDER BY pinned DESC, updated_at DESC, room_id LIMIT 50`, ...words)
    .toArray()
    .map(toChat)
}

/** Chats made before the rename name Kiko "yuki". They name it "kiko" from here on. */
export function renameLegacyAgent(sql: SqlStorage): void {
  sql.exec(`UPDATE chats SET agents = replace(agents, '"yuki"', '"kiko"') WHERE agents LIKE '%"yuki"%'`)
}

export function listChats(sql: SqlStorage): Chat[] {
  return sql.exec<Row>("SELECT * FROM chats WHERE pair = 0 ORDER BY pinned DESC, updated_at DESC, room_id").toArray().map(toChat)
}

function write(sql: SqlStorage, chat: Chat): ChatChange {
  sql.exec(
    `INSERT INTO chats (room_id, title, pinned, muted, last_seq, last_preview, unread, updated_at, agents, private, last, mentions, grp, pair)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(room_id) DO UPDATE SET title = excluded.title, pinned = excluded.pinned, muted = excluded.muted,
       last_seq = excluded.last_seq, last_preview = excluded.last_preview, unread = excluded.unread,
       updated_at = excluded.updated_at, agents = excluded.agents, private = excluded.private,
       last = excluded.last, mentions = excluded.mentions, grp = excluded.grp, pair = excluded.pair`,
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
    chat.last ? JSON.stringify(chat.last) : null,
    chat.mentions ?? 0,
    chat.group ? 1 : 0,
    chat.pair ? 1 : 0,
  )
  return { t: "chat", chat }
}

function next(current: Chat | null, op: ChatOp, now: number, pair: boolean): Chat | null | undefined {
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
        ...(op.agents?.length ? { agents: agentIds(op.agents) } : {}),
        ...(pair ? { pair: true as const, private: true as const } : {}),
      }
    case "rename": {
      const title = clip(op.title, MAX_TITLE)
      if (!current || current.title === title) return null
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

/** Distinct ids, capped. A chat's agents are a set: a repeat adds nothing. */
const agentIds = (agents: readonly string[]): string[] => [...new Set(agents.map((id) => id.slice(0, 64)))].slice(0, MAX_AGENTS)

/** A chat's agents follow its room's members, so its tile shows who is really in it. */
export function setChatAgents(sql: SqlStorage, roomId: string, agents: readonly string[]): ChatChange | null {
  const current = getChat(sql, roomId)
  if (!current) return null
  const ids = agentIds(agents)
  const same = (current.agents ?? []).length === ids.length && ids.every((id) => current.agents?.includes(id))
  return same ? null : write(sql, { ...current, agents: ids })
}

/** `pair` marks the chat a create makes as a private talk between two agents. Only the server sets it. */
export function applyChatOp(sql: SqlStorage, op: ChatOp, now: number, pair = false): ChatChange | null {
  const current = getChat(sql, op.roomId)
  const chat = next(current, op, now, pair)
  if (chat === null) return null
  if (chat === undefined) {
    sql.exec("DELETE FROM chats WHERE room_id = ?", op.roomId)
    return { t: "chat_removed", roomId: op.roomId }
  }
  return write(sql, chat)
}

function nextLast(current: ChatLast | undefined, touched: ChatLast | undefined): ChatLast | undefined {
  if (current?.kind === "renamed" && (!touched || touched.at < current.at)) return current
  return touched ?? current
}

export function touchChat(sql: SqlStorage, roomId: string, touch: Touch, now: number): ChatChange | null {
  const current = getChat(sql, roomId)
  if (!current || touch.lastSeq < current.lastSeq) return null
  const last = nextLast(current.last, touch.last)
  const mentions = Math.max(0, Math.floor(touch.mentions ?? current.mentions ?? 0))
  const { last: _l, mentions: _m, group: _g, ...rest } = current
  const chat: Chat = {
    ...rest,
    lastSeq: touch.lastSeq,
    lastPreview: clip(touch.lastPreview, MAX_PREVIEW),
    unread: Math.max(0, Math.floor(touch.unread)),
    updatedAt: touch.last ? Math.max(last?.at ?? 0, current.updatedAt) : touch.lastSeq === current.lastSeq ? current.updatedAt : now,
    ...(last ? { last } : {}),
    ...(mentions ? { mentions } : {}),
    ...((touch.group ?? current.group) ? { group: true as const } : {}),
  }
  if (touch.lastSeq === current.lastSeq && JSON.stringify(chat) === JSON.stringify(current)) return null
  return write(sql, chat)
}
