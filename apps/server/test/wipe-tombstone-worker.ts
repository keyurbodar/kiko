import type { Envelope } from "@yuki/protocol"
import { ROOM_ID_HEADER, USER_ID_HEADER } from "../src/lib/names"
import type { AgentDO } from "../src/agent/agent-do"
import type { RoomDO } from "../src/room/room-do"

export { AgentDO } from "../src/agent/agent-do"
export { RoomDO } from "../src/room/room-do"

type Env = { ROOM: DurableObjectNamespace<RoomDO>; AGENT: DurableObjectNamespace<AgentDO> }

const ROOM = "01J0000000000000000000000R"

const human = (): Envelope => ({ id: "human:m1", roomId: ROOM as Envelope["roomId"], from: { kind: "human" }, body: "hello", hop: 0, rootId: "m1" })

export default {
	async fetch(request: Request, env: Env) {
		const [, kind, op] = new URL(request.url).pathname.split("/")
		if (kind === "room") {
			const stub = env.ROOM.get(env.ROOM.idFromName(`room:alice:${ROOM}`))
			if (op === "wipe") return Response.json(await stub.deleteAll())
			const headers = new Headers({ upgrade: "websocket", [USER_ID_HEADER]: "alice", [ROOM_ID_HEADER]: ROOM })
			const res = await stub.fetch(new Request("http://do/ws", { headers }))
			return Response.json({ status: res.status })
		}
		const stub = env.AGENT.get(env.AGENT.idFromName(`agent:alice:${ROOM}:ada`))
		if (op === "wipe") return Response.json(await stub.deleteAll())
		if (op === "rows") return Response.json(await stub.storedRows())
		try {
			return Response.json({ admitted: (await stub.receive([human()], "")).admitted })
		} catch (e) {
			return Response.json({ error: e instanceof Error ? e.message : String(e) })
		}
	},
}
