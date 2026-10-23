import type { RoomId } from "@kiko/protocol"
import { createSignal } from "solid-js"
import { chatAfter } from "../lib/chats"
import { useApp } from "../lib/store"

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
  const current = useApp.chatById(id)
  if (next === "" || !current || next === current.name) return
  useApp.user()?.rename(id as RoomId, next)
}

export function togglePin(id: string): void {
  useApp.togglePinned(id)
}

export function toggleMute(id: string): void {
  const chat = useApp
    .user()
    ?.chats()
    .find((c) => c.roomId === id)
  if (chat) useApp.user()?.mute(chat.roomId, !chat.muted)
}

export function sidebarOrder() {
  const rows = useApp.bots()
  return [...rows.filter((r) => r.pinned), ...rows.filter((r) => !r.pinned)]
}

let lastClosed: string | null = null

export function reopenClosedChat(): string | null {
  const id = lastClosed
  lastClosed = null
  return id && useApp.chat(id) ? id : null
}

export function closeChat(id: string, active: string | null, go: (path: string) => void): void {
  const next = chatAfter(
    sidebarOrder().map((r) => r.id),
    id,
  )
  lastClosed = id
  if (active === id) go(next ? `/chat/${next}` : "/chat")
}

export function deleteChat(id: string, active: string | null, go: (path: string) => void): void {
  const next = chatAfter(
    sidebarOrder().map((r) => r.id),
    id,
  )
  useApp.user()?.remove(id as RoomId)
  clearUnreadMark(id)
  if (active === id) go(next ? `/chat/${next}` : "/chat")
}
