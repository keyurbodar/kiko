import { getSetting, setSetting } from "../lib/settings"
import { isRoomId, newRoomId, type Chat, type ChatOp, type RoomId } from "@kiko/protocol"

// The stored key predates the rename, so existing accounts keep the chat they already have.
const KEY = "yuki_home"
const TITLE = "Kiko"

export function kikoChatRoom(sql: SqlStorage): RoomId | null {
  const value = getSetting(sql, KEY)
  return value && isRoomId(value) ? value : null
}

export function kikoChatOps(sql: SqlStorage, exists: (roomId: RoomId) => boolean): ChatOp[] {
  let roomId = kikoChatRoom(sql)
  if (roomId && exists(roomId)) return []
  if (!roomId) {
    roomId = newRoomId()
    setSetting(sql, KEY, roomId)
  }
  return [
    { op: "create", roomId, title: TITLE, agents: ["yuki"] },
    { op: "pin", roomId, pinned: true },
  ]
}

export const movesKikoChat = (sql: SqlStorage, op: ChatOp) =>
  (op.op === "delete" || (op.op === "pin" && !op.pinned)) && op.roomId === kikoChatRoom(sql)

export const markKikoChat = (sql: SqlStorage, chat: Chat): Chat => (chat.roomId === kikoChatRoom(sql) ? { ...chat, kiko: true } : chat)
