import { showToastV2 } from "@kiko/ui/v2/toast-v2"
import { openChat } from "../app/history"
import type { RoomId } from "@kiko/protocol"
import { createSignal } from "solid-js"
import { chatAfter } from "../lib/chats"
import { room } from "../state/room"
import { user } from "../state/user"

const [renaming, setRenaming] = createSignal<string | null>(null)
export const renamingId = renaming

const [deleting, setDeleting] = createSignal<string | null>(null)
export const deletingChatId = deleting
export const askDeleteChat = (id: string): void => {
  setDeleting(id)
}
export const cancelDeleteChat = (): void => {
  setDeleting(null)
}

export { clearUnreadMark, markedUnread, markUnread } from "./unread-mark"
import { clearUnreadMark } from "./unread-mark"

export function startRename(id: string): void {
  setRenaming(id)
}

export function cancelRename(): void {
  setRenaming(null)
}

export function commitRename(id: string, title: string): void {
  setRenaming(null)
  const next = title.trim()
  const current = room.chatById(id)
  if (next === "" || !current || next === current.name) return
  user.rename(id as RoomId, next)
}

export function togglePin(id: string): void {
  user.togglePinned(id)
}

export function toggleMute(id: string): void {
  const chat = user.chats().find((c) => c.roomId === id)
  if (chat) user.mute(chat.roomId, !chat.muted)
}

export function sidebarOrder() {
  const rows = room.bots()
  return [...rows.filter((r) => r.pinned), ...rows.filter((r) => !r.pinned)]
}

let lastClosed: string | null = null

export function reopenClosedChat(): string | null {
  const id = lastClosed
  lastClosed = null
  return id && user.chat(id) ? id : null
}

export function closeChat(id: string, active: string | null): void {
  const next = chatAfter(
    sidebarOrder().map((r) => r.id),
    id,
  )
  lastClosed = id
  if (active === id) openChat(next)
  showToastV2({
    title: "Closed chat",
    action: {
      label: "Undo",
      variant: "secondary",
      onClick: () => {
        const back = reopenClosedChat()
        if (back) openChat(back)
      },
    },
  })
}

export function deleteChat(id: string, active: string | null): void {
  const next = chatAfter(
    sidebarOrder().map((r) => r.id),
    id,
  )
  user.remove(id as RoomId)
  clearUnreadMark(id)
  if (active === id) openChat(next)
}
