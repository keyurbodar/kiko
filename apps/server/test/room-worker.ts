import { ROOM_ID_HEADER, USER_ID_HEADER } from "../src/lib/names"
import type { RoomDO } from "../src/room/room-do"

// The real RoomDO behind a worker with no session check. `/ws/<roomId>` opens the
// room socket as the user `alice`. `/typing/<roomId>/<slug>/<0|1>` calls the typing RPC.

export { RoomDO } from "../src/room/room-do"

type Env = { ROOM: DurableObjectNamespace<RoomDO> }

export default {
	async fetch(request: Request, env: Env) {
		const [, kind, roomId, slug, on] = new URL(request.url).pathname.split("/")
		const stub = env.ROOM.get(env.ROOM.idFromName(`room:alice:${roomId}`))
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
