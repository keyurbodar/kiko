// The kiko chat. Every user has one, pinned, with kiko as its only agent, and it cannot be
// deleted. Its room id is minted once and kept in `settings`, so making sure it exists is
// safe to run on every sign-in.

import { isRoomId, newRoomId, type Chat, type ChatOp, type RoomId } from "@kiko/protocol"

// The stored key predates the rename, so existing accounts keep the chat they already have.
const KEY = "kiko_home"

export function kikoChatRoom(sql: SqlStorage): RoomId | null {
  const row = sql.exec<{ value: string }>("SELECT value FROM settings WHERE key = ?", KEY).toArray()[0]
  return row && isRoomId(row.value) ? row.value : null
}

/** The ops that bring the kiko chat into being. Empty once it exists. */
export function kikoChatOps(sql: SqlStorage, exists: (roomId: RoomId) => boolean): ChatOp[] {
  let roomId = kikoChatRoom(sql)
  if (roomId && exists(roomId)) return []
  if (!roomId) {
    roomId = newRoomId()
    sql.exec("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", KEY, roomId)
  }
  return [
    { op: "create", roomId, title: "kiko", agents: ["kiko"] },
    { op: "pin", roomId, pinned: true },
  ]
}

/** True when `op` would delete the kiko chat, which never happens. */
export const deletesKikoChat = (sql: SqlStorage, op: ChatOp) => op.op === "delete" && op.roomId === kikoChatRoom(sql)

/** The chat with `kiko` set when it is the kiko chat. */
export const markKikoChat = (sql: SqlStorage, chat: Chat): Chat => (chat.roomId === kikoChatRoom(sql) ? { ...chat, kiko: true } : chat)
