// The kiko chat. Every user has one, pinned, with kiko as its only agent, and it cannot be
// deleted. Its room id is minted once and kept in `settings`, so making sure it exists is
// safe to run on every hello.

import { isRoomId, newRoomId, type Chat, type ChatOp, type RoomId } from "@kiko/protocol"

const HOME_KEY = "kiko_home"

export function homeRoom(sql: SqlStorage): RoomId | null {
  const row = sql.exec<{ value: string }>("SELECT value FROM settings WHERE key = ?", HOME_KEY).toArray()[0]
  return row && isRoomId(row.value) ? row.value : null
}

/** The ops that bring the kiko chat into being. Empty once it exists. */
export function homeOps(sql: SqlStorage, exists: (roomId: RoomId) => boolean): ChatOp[] {
  let roomId = homeRoom(sql)
  if (roomId && exists(roomId)) return []
  if (!roomId) {
    roomId = newRoomId()
    sql.exec("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", HOME_KEY, roomId)
  }
  return [
    { op: "create", roomId, title: "kiko", agents: ["kiko"] },
    { op: "pin", roomId, pinned: true },
  ]
}

/** True when `op` would delete the kiko chat, which never happens. */
export const deletesHome = (sql: SqlStorage, op: ChatOp) => op.op === "delete" && op.roomId === homeRoom(sql)

/** The chat with `home` set when it is the kiko chat. */
export const markHome = (sql: SqlStorage, chat: Chat): Chat => (chat.roomId === homeRoom(sql) ? { ...chat, home: true } : chat)
