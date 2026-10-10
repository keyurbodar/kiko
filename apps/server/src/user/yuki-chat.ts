// The yuki chat. Every user has one, pinned, with yuki as its only agent, and it cannot be
// deleted or unpinned. Its room id is minted once and kept in `settings`, so making sure it exists is
// safe to run on every sign-in.

import { getSetting, setSetting } from "../lib/settings"
import { isRoomId, newRoomId, type Chat, type ChatOp, type RoomId } from "@yuki/protocol"

// The stored key predates the rename, so existing accounts keep the chat they already have.
const KEY = "yuki_home"
const TITLE = "Yuki"

export function yukiChatRoom(sql: SqlStorage): RoomId | null {
  const value = getSetting(sql, KEY)
  return value && isRoomId(value) ? value : null
}

/** The ops that bring the yuki chat into being. Empty once it exists. */
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

/** True when `op` would delete or unpin the yuki chat, which never happens. */
export const movesYukiChat = (sql: SqlStorage, op: ChatOp) =>
  (op.op === "delete" || (op.op === "pin" && !op.pinned)) && op.roomId === yukiChatRoom(sql)

/** The chat with `yuki` set when it is the yuki chat. */
export const markYukiChat = (sql: SqlStorage, chat: Chat): Chat => (chat.roomId === yukiChatRoom(sql) ? { ...chat, yuki: true } : chat)
