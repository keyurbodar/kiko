import { DurableObject } from "cloudflare:workers"
import { downloadRoute } from "../src/files/download"
import { uploadRoute } from "../src/files/upload"
import type { Env } from "../src/index"

// The real upload and download routes and the real RoomDO, with the session taken
// from an `x-test-user` header. `/keys` lists every R2 key.

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
		if (new URL(request.url).pathname === "/keys") {
			const page = await env.FILES.list()
			return Response.json(page.objects.map((o) => o.key))
		}
		return (
			(await uploadRoute(request, env, lookup as never)) ??
			(await downloadRoute(request, env, lookup as never)) ??
			new Response("not found", { status: 404 })
		)
	},
}
