import type { ChatSearchPage, RoomId } from "@kiko/protocol"
import { apiFetch } from "../lib/api"
import { useApp } from "../lib/store"
import type { HitPage } from "./model"
import type { SearchScope } from "./state"

async function searchAll(query: string, before?: number): Promise<HitPage | null> {
  const params = new URLSearchParams({ q: query })
  if (before !== undefined) params.set("before", String(before))
  try {
    const res = await apiFetch(`/api/search?${params}`, { credentials: "same-origin" })
    return res.ok ? ((await res.json()) as ChatSearchPage) : null
  } catch {
    return null
  }
}

async function searchChat(query: string, before?: number): Promise<HitPage | null> {
  const roomId = useApp.activeThreadId() as RoomId | null
  if (!roomId) return { results: [], next: null }
  const page = await useApp.searchRoom(query, before)
  return page && { results: page.results.map((hit) => ({ ...hit, roomId })), next: page.next }
}

/** One page of hits for the overlay and the palette: the open chat over its socket, or every chat over the Worker. */
export const fetchHits = (scope: SearchScope, query: string, before?: number): Promise<HitPage | null> =>
  scope === "chat" ? searchChat(query, before) : searchAll(query, before)
