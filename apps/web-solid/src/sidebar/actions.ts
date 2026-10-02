import type { RoomId } from "@kiko/protocol"
import { createSignal } from "solid-js"
import { openTabs } from "../app/open-tabs"
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
  const next = title.trim().toLowerCase()
  const current = useApp.chatById(id)
  if (next === "" || !current || next === current.name) return
  useApp.user()?.rename(id as RoomId, next)
}

export function togglePin(id: string): void {
  useApp.togglePinned(id)
}

export function toggleMute(id: string): void {
  const chat = useApp.user()?.chats().find((c) => c.roomId === id)
  if (chat) useApp.user()?.mute(chat.roomId, !chat.muted)
}

/** Closes the chat's tab. The chat stays in the list. */
export function closeChat(id: string, active: string | null, go: (path: string) => void): void {
  const ids = openTabs.ids()
  const at = ids.indexOf(id)
  openTabs.close(id)
  if (active !== id) return
  const rest = openTabs.ids()
  const next = rest[at] ?? rest[at - 1]
  go(next ? `/chat/${next}` : "/chat")
}

export function deleteChat(id: string, active: string | null, go: (path: string) => void): void {
  useApp.user()?.remove(id as RoomId)
  clearUnreadMark(id)
  openTabs.close(id)
  if (active === id) go("/chat")
}
