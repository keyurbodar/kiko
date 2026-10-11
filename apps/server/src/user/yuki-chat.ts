import { getSetting, setSetting } from "../lib/settings"
import { isRoomId, newRoomId, type Chat, type ChatOp, type RoomId } from "@yuki/protocol"

// The stored key predates the rename, so existing accounts keep the chat they already have.
const KEY = "yuki_home"
const TITLE = "Yuki"

export function yukiChatRoom(sql: SqlStorage): RoomId | null {
  const value = getSetting(sql, KEY)
  return value && isRoomId(value) ? value : null
}

export function yukiChatOps(sql: SqlStorage, exists: (roomId: RoomId) => boolean): ChatOp[] {
  let roomId = yukiChatRoom(sql)
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

export const movesYukiChat = (sql: SqlStorage, op: ChatOp) =>
  (op.op === "delete" || (op.op === "pin" && !op.pinned)) && op.roomId === yukiChatRoom(sql)

export const markYukiChat = (sql: SqlStorage, chat: Chat): Chat => (chat.roomId === yukiChatRoom(sql) ? { ...chat, yuki: true } : chat)
