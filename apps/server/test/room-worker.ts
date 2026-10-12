import { ROOM_ID_HEADER, USER_ID_HEADER } from "../src/lib/names"
import { RoomDO } from "../src/room/room-do"

export { RoomDO }

// The stored row count, which only the test measures. It counts what main's wipe counted, minus the meta and
// search tables, so the log's growth is measured the same way it was before the wipe was removed.
export class RoomProbe extends RoomDO {
	async storedRows(): Promise<number> {
		const sql = this.ctx.storage.sql
		const tables = sql
			.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
			.toArray()
			.map((r) => r.name)
			.filter((name) => name !== "meta" && !name.startsWith("sqlite_") && !name.startsWith("_cf_") && !name.includes("_fts"))
		let rows = (await this.ctx.storage.list()).size
		for (const name of tables) rows += sql.exec<{ n: number }>(`SELECT count(*) AS n FROM "${name}"`).one().n
		return rows
	}
}

type Env = { ROOM: DurableObjectNamespace<RoomProbe> }

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
