import { type ChatSearchHit, type ChatSearchPage, mergeHits } from "@yuki/protocol"
import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { roomStub, userStub } from "../lib/names"

// Search across chats. Architecture section 9.2.
//   GET /api/search?q=<query>&before=<epoch ms>&limit=<n>  ->  ChatSearchPage
//
// Each room indexes its own messages, so the Worker asks the user's most recently active rooms in
// parallel and merges their pages by time. One request costs one UserDO call plus one call per
// room: `MAX_ROOMS` keeps that well under the Free plan's 50 subrequests per invocation. A user
// with more chats gets `partial: true`, and the older chats are not searched.
// Nothing here waits inside a Durable Object: the fan-out is the Worker's.

const PATH = "/api/search"
export const MAX_ROOMS = 30
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

export async function searchRoute(request: Request, env: Env): Promise<Response | null> {
	const url = new URL(request.url)
	if (url.pathname !== PATH) return null
	if (request.method !== "GET") return Response.json({ error: "method not allowed" }, { status: 405 })
	const user = await getSessionUser(request, env)
	if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
	const query = (url.searchParams.get("q") ?? "").slice(0, 200)
	const before = Number(url.searchParams.get("before")) || undefined
	const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || DEFAULT_LIMIT, 1), MAX_LIMIT)
	if (!query.trim()) return Response.json({ results: [], next: null, partial: false } satisfies ChatSearchPage)

	const chats = (await userStub(env.USER, user.id).listChats()).sort((a, b) => b.updatedAt - a.updatedAt)
	const searched = chats.slice(0, MAX_ROOMS)
	// A room that fails is left out of this page, not the whole answer.
	const pages = await Promise.all(
		searched.map((chat) =>
			roomStub(env.ROOM, user.id, chat.roomId)
				.search(query, { beforeAt: before, limit })
				.then(
					(page) => ({
						results: page.results.map((hit): ChatSearchHit => ({ ...hit, roomId: chat.roomId })),
						more: page.next !== null,
					}),
					(error: unknown) => {
						console.error(`search failed in a room: ${error instanceof Error ? error.message : String(error)}`)
						return { results: [], more: false }
					},
				),
		),
	)
	const merged = mergeHits(pages, limit)
	return Response.json({ ...merged, partial: chats.length > searched.length } satisfies ChatSearchPage)
}
