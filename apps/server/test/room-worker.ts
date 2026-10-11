import { ROOM_ID_HEADER, USER_ID_HEADER } from "../src/lib/names"
import type { RoomDO } from "../src/room/room-do"

export { RoomDO } from "../src/room/room-do"

type Env = { ROOM: DurableObjectNamespace<RoomDO> }

export default {
	async fetch(request: Request, env: Env) {
		const [, kind, roomId, slug, on] = new URL(request.url).pathname.split("/")
		const stub = env.ROOM.get(env.ROOM.idFromName(`room:alice:${roomId}`))
		if (kind === "post") {
			const { runId, block } = (await request.json()) as { runId: string; block: string }
			return Response.json(await stub.post(slug as never, runId, 0, 0, block))
		}
		if (kind === "rows") return Response.json(await stub.storedRows())
		if (kind === "typing") {
			await stub.setTyping(slug as never, on === "1")
			return new Response("ok")
		}
		const headers = new Headers(request.headers)
		headers.set(USER_ID_HEADER, "alice")
		headers.set(ROOM_ID_HEADER, roomId!)
		return stub.fetch(new Request(request, { headers }))
	},
}
