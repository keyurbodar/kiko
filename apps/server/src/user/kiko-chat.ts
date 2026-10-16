import { getSetting, setSetting } from "../lib/settings"
import { isRoomId, KIKO, newRoomId, sameAgentChat, type Chat, type ChatOp, type RoomId } from "@kiko/protocol"

const KEY = "kiko_home"
// The key and agent id from before the rename. An account made then still holds them.
const LEGACY_KEY = "yuki_home"
const TITLE = "Kiko"
const LEGACY_TITLE = "Yuki"

export function kikoChatRoom(sql: SqlStorage): RoomId | null {
  const value = getSetting(sql, KEY)
  return value && isRoomId(value) ? value : null
}

/**
 * What ensureHome applies so the account has exactly one pinned Kiko chat. The chat the account
 * already has is adopted: the one the setting names, the one the old setting names, or else the
 * most recent chat with Kiko alone. Only an account with none gets a new one.
 */
export function kikoChatOps(sql: SqlStorage, chats: readonly Chat[]): ChatOp[] {
  const has = (id: string | null) => (id ? chats.find((c) => c.roomId === id) : undefined)
  const found = has(kikoChatRoom(sql)) ?? has(getSetting(sql, LEGACY_KEY)) ?? sameAgentChat(chats, [KIKO])
  if (found) {
    setSetting(sql, KEY, found.roomId)
    return [
      ...(found.pinned ? [] : [{ op: "pin" as const, roomId: found.roomId, pinned: true }]),
      ...(found.title === LEGACY_TITLE ? [{ op: "rename" as const, roomId: found.roomId, title: TITLE }] : []),
    ]
  }
  const roomId = newRoomId()
  setSetting(sql, KEY, roomId)
  return [
    { op: "create", roomId, title: TITLE, agents: [KIKO] },
    { op: "pin", roomId, pinned: true },
  ]
}

export const movesKikoChat = (sql: SqlStorage, op: ChatOp) =>
  (op.op === "delete" || (op.op === "pin" && !op.pinned)) && op.roomId === kikoChatRoom(sql)

export const markKikoChat = (sql: SqlStorage, chat: Chat): Chat => (chat.roomId === kikoChatRoom(sql) ? { ...chat, kiko: true } : chat)
