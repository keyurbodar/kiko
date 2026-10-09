import { DurableObject } from "cloudflare:workers"
import { downloadRoute } from "../src/files/download"
import { uploadRoute } from "../src/files/upload"
import type { Env } from "../src/index"
import { ROOM_ID_HEADER, roomStub, USER_ID_HEADER } from "../src/lib/names"

// The real upload and download routes and the real RoomDO, with the session taken
// from an `x-test-user` header. `/keys` lists every R2 key. `/ws/<user>/<roomId>` opens the room
// socket as that user, and `/sweep/<user>/<roomId>?at=` runs the pending sweep as of `at`.

export { RoomDO } from "../src/room/room-do"

/** The upload route records each room in `UserDO` first. This one accepts every room. */
export class UserDO extends DurableObject {
	async recordRoom() {
		return true
	}
}

const lookup = async (request: Request) => {
	const id = request.headers.get("x-test-user")
	return id ? { id } : null
}

export default {
	async fetch(request: Request, env: Env) {
		const url = new URL(request.url)
		if (url.pathname === "/keys") {
			const page = await env.FILES.list()
			return Response.json(page.objects.map((o) => o.key))
		}
		const [, kind, user, roomId] = url.pathname.split("/")
		if (kind === "sweep") return Response.json(await roomStub(env.ROOM, user!, roomId!).sweepPending(Number(url.searchParams.get("at"))))
		if (kind === "ws") {
			const headers = new Headers(request.headers)
			headers.set(USER_ID_HEADER, user!)
			headers.set(ROOM_ID_HEADER, roomId!)
			return roomStub(env.ROOM, user!, roomId!).fetch(new Request(request, { headers }))
		}
		return (
			(await uploadRoute(request, env, lookup as never)) ??
			(await downloadRoute(request, env, lookup as never)) ??
			new Response("not found", { status: 404 })
		)
	},
}
