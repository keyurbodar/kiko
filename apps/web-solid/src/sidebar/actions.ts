import type { RoomId } from "@kiko/protocol"
import { createSignal } from "solid-js"
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

// DEVIATION: the protocol has no "mark as unread" op, and `protocol` is not in
// this task's files. The mark is a client-only overlay, kept per tab. It is
// cleared when the chat is opened.
const [forced, setForced] = createSignal<ReadonlySet<string>>(new Set())
export const markedUnread = (id: string): boolean => forced().has(id)

export function markUnread(id: string): void {
  setForced((s) => new Set(s).add(id))
}

export function clearUnreadMark(id: string): void {
  if (!forced().has(id)) return
  setForced((s) => {
    const next = new Set(s)
    next.delete(id)
    return next
  })
}

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

/** The chat that takes `id`'s place in the sidebar list once it leaves: the one below it, else the one above. */
export function chatAfter(id: string): string | null {
  const rest = sidebarOrder().filter((r) => r.id !== id)
  const at = sidebarOrder().findIndex((r) => r.id === id)
  return (rest[at] ?? rest[at - 1])?.id ?? null
}

let lastClosed: string | null = null

/** The chat `closeChat` last left, while it still exists. */
export function reopenClosedChat(): string | null {
  const id = lastClosed
  lastClosed = null
  return id && useApp.chat(id) ? id : null
}

/**
 * Leaves the chat, and lands on its neighbour in the list when it was the open one. The chat stays in
 * the list, except a temporary chat, which leaving deletes (architecture section 7.11).
 */
export function closeChat(id: string, active: string | null, go: (path: string) => void): void {
  const next = chatAfter(id)
  lastClosed = id
  const chat = useApp.chat(id)
  if (chat?.temp) useApp.user()?.remove(chat.roomId)
  if (active === id) go(next ? `/chat/${next}` : "/chat")
}

export function deleteChat(id: string, active: string | null, go: (path: string) => void): void {
  const next = chatAfter(id)
  useApp.user()?.remove(id as RoomId)
  clearUnreadMark(id)
  if (active === id) go(next ? `/chat/${next}` : "/chat")
}
