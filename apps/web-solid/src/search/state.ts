import type { MessageId, RoomId } from "@kiko/protocol"
import { createRoot, createSignal, lazy } from "solid-js"

export type SearchScope = "chat" | "all"

export type JumpRequest = { roomId: RoomId; id: MessageId; seq: number }

const state = createRoot(() => ({
  scope: createSignal<SearchScope | null>(null),
  jump: createSignal<JumpRequest | null>(null),
}))

export const searchScope = state.scope[0]
export const setSearchScope = state.scope[1]
export const openSearch = (scope: SearchScope) => {
  preloadSearch()
  setSearchScope(scope)
}
export const closeSearch = () => setSearchScope(null)

export const jumpRequest = state.jump[0]
export const requestJump = state.jump[1]

const load = () => import("./overlay")
export const SearchOverlay = lazy(load)

let preloaded = false
export function preloadSearch(): void {
  if (preloaded) return
  preloaded = true
  void load()
}
