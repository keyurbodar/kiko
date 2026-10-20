import { getSetting, setSetting } from "../lib/settings"
import { isRoomId, KIKO, KIKO_HOME_ROOM, sameAgentChat, type Chat, type ChatOp, type RoomId } from "@kiko/protocol"

const KEY = "kiko_home"
const LEGACY_KEY = "yuki_home"
const TITLE = "Kiko"
const LEGACY_TITLE = "Yuki"

export function kikoChatRoom(sql: SqlStorage): RoomId | null {
  const value = getSetting(sql, KEY)
  return value && isRoomId(value) ? value : null
}

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
  const roomId = KIKO_HOME_ROOM
  setSetting(sql, KEY, roomId)
  return [
    { op: "create", roomId, title: TITLE, agents: [KIKO] },
    { op: "pin", roomId, pinned: true },
  ]
}

export const movesKikoChat = (sql: SqlStorage, op: ChatOp) =>
  (op.op === "delete" || (op.op === "pin" && !op.pinned)) && op.roomId === kikoChatRoom(sql)

export const markKikoChat = (sql: SqlStorage, chat: Chat): Chat => (chat.roomId === kikoChatRoom(sql) ? { ...chat, kiko: true } : chat)
