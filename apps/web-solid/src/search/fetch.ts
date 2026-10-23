import type { RoomId } from "@kiko/protocol"
import { owner, run } from "../state/runtime"
import { room } from "../state/room"
import type { HitPage } from "./model"
import type { SearchScope } from "./state"

async function searchAll(query: string, before?: number): Promise<HitPage | null> {
  const result = await run(owner.commands.searchMessages, { query, ...(before !== undefined ? { before } : {}) })
  return result._tag === "Success" ? result.value : null
}

async function searchChat(query: string, before?: number): Promise<HitPage | null> {
  const roomId = room.activeId() as RoomId | null
  if (!roomId) return { results: [], next: null }
  const page = await room.searchRoom(query, before)
  return page && { results: page.results.map((hit) => ({ ...hit, roomId })), next: page.next }
}

export const fetchHits = (scope: SearchScope, query: string, before?: number): Promise<HitPage | null> =>
  scope === "chat" ? searchChat(query, before) : searchAll(query, before)
