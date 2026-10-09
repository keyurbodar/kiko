import type { MessageId, RoomId } from "@yuki/protocol"
import { createRoot, createSignal, lazy } from "solid-js"

/*
 * Message search (⌘F and ⌘⇧F): whether the overlay is open, in which scope, and the one jump it
 * asks the transcript for. Kept apart from the overlay, which loads on intent like the palette, so
 * the commands and the transcript can reach it without loading it.
 */
export type SearchScope = "chat" | "all"

/** A message to show and mark, possibly in a chat that is not open yet. */
export type JumpRequest = { roomId: RoomId; id: MessageId; seq: number }

const state = createRoot(() => ({
  scope: createSignal<SearchScope | null>(null),
  jump: createSignal<JumpRequest | null>(null),
}))

/** The open overlay's scope, or null when it is closed. */
export const searchScope = state.scope[0]
export const setSearchScope = state.scope[1]
export const openSearch = (scope: SearchScope) => {
  preloadSearch()
  setSearchScope(scope)
}
export const closeSearch = () => setSearchScope(null)

/** The jump the transcript has yet to make. The chat route takes it once its room is open. */
export const jumpRequest = state.jump[0]
export const requestJump = state.jump[1]

const load = () => import("./overlay")
/** The overlay, loaded on the first modifier press or the first open. */
export const SearchOverlay = lazy(load)

let preloaded = false
export function preloadSearch(): void {
  if (preloaded) return
  preloaded = true
  void load()
}
