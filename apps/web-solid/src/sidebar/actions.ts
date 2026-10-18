import type { RoomId } from "@kiko/protocol"
import { createSignal } from "solid-js"
import { chatAfter } from "../lib/chats"
import { useApp } from "../lib/store"

/*
 * Every sidebar action, once. The context menu, the pinned tiles and the
 * command registry all call these, so a menu item and its shortcut cannot
 * drift apart. Each one applies through the user store, which lays the edit
 * over the list at once and sends it after.
 */

const [renaming, setRenaming] = createSignal<string | null>(null)
/** The chat whose title is being edited in place, or null. */
export const renamingId = renaming

/*
 * Deleting a chat cannot be undone, and the palette runs a command on one Enter with no menu to hold
 * a two-step confirm. So the destructive path asks here, once, and the answer is a real dialog.
 */
const [deleting, setDeleting] = createSignal<string | null>(null)
/** The chat waiting for a delete confirmation, or null. */
export const deletingChatId = deleting
export const askDeleteChat = (id: string): void => {
  setDeleting(id)
}
export const cancelDeleteChat = (): void => {
  setDeleting(null)
}

// The unread mark is its own module, because the chat route clears it too.
export { clearUnreadMark, markedUnread, markUnread } from "./unread-mark"
import { clearUnreadMark } from "./unread-mark"

export function startRename(id: string): void {
  setRenaming(id)
}

export function cancelRename(): void {
  setRenaming(null)
}

/** Commits an edited title. An empty or unchanged title is a cancel. */
export function commitRename(id: string, title: string): void {
  setRenaming(null)
  const next = title.trim()
  const current = useApp.chatById(id)
  if (next === "" || !current || next === current.name) return
  useApp.user()?.rename(id as RoomId, next)
}

/** The kiko chat stays pinned; the store ignores it. */
export function togglePin(id: string): void {
  useApp.togglePinned(id)
}

export function toggleMute(id: string): void {
  const chat = useApp.user()?.chats().find((c) => c.roomId === id)
  if (chat) useApp.user()?.mute(chat.roomId, !chat.muted)
}

/** The sidebar's order: pinned tiles first, then the list. */
export function sidebarOrder() {
  const rows = useApp.bots()
  return [...rows.filter((r) => r.pinned), ...rows.filter((r) => !r.pinned)]
}

let lastClosed: string | null = null

/** The chat `closeChat` last left, while it still exists. */
export function reopenClosedChat(): string | null {
  const id = lastClosed
  lastClosed = null
  return id && useApp.chat(id) ? id : null
}

/** Leaves the chat, and lands on its neighbour in the list when it was the open one. The chat stays in the list. */
export function closeChat(id: string, active: string | null, go: (path: string) => void): void {
  const next = chatAfter(sidebarOrder().map((r) => r.id), id)
  lastClosed = id
  if (active === id) go(next ? `/chat/${next}` : "/chat")
}

export function deleteChat(id: string, active: string | null, go: (path: string) => void): void {
  const next = chatAfter(sidebarOrder().map((r) => r.id), id)
  useApp.user()?.remove(id as RoomId)
  clearUnreadMark(id)
  if (active === id) go(next ? `/chat/${next}` : "/chat")
}
