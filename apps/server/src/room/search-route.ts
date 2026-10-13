import { type ChatSearchHit, type ChatSearchPage, mergeHits } from "@kiko/protocol"
import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { roomStub, userStub } from "../lib/names"

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
