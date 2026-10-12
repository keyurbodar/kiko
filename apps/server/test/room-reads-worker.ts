import { DurableObject } from "cloudflare:workers"
import { ROOM_ID_HEADER, USER_ID_HEADER } from "../src/lib/names"
import { RoomDO as Room } from "../src/room/room-do"

// The room calls UserDO after a send (touchChat, recordRoom). A stub that accepts those calls keeps them on the path.
export class UserDO extends DurableObject {
	async recordRoom(): Promise<boolean> {
		return true
	}
	async touchChat(): Promise<void> {}
	async chatTasks(): Promise<void> {}
	async captureHuman(): Promise<void> {}
	async getChat(): Promise<null> {
		return null
	}
	async takeTurn(): Promise<{ ok: true }> {
		return { ok: true }
	}
}

// Every statement's cursor, read once when a test asks for the total. rowsRead is final once a cursor is consumed.
const open: SqlStorageCursor<Record<string, SqlStorageValue>>[] = []
let settled = 0

function settle(): void {
	for (const cursor of open.splice(0)) settled += cursor.rowsRead
}

export class RoomDO extends Room {
	constructor(ctx: DurableObjectState, env: ConstructorParameters<typeof Room>[1]) {
		const sql = ctx.storage.sql
		const exec = sql.exec.bind(sql)
		Object.defineProperty(sql, "exec", {
			configurable: true,
			value: (query: string, ...bindings: SqlStorageValue[]) => {
				const cursor = exec(query, ...bindings)
				open.push(cursor)
				// A cursor is consumed by the time the next statement runs, so settling it here loses nothing.
				if (open.length > 10_000) settle()
				return cursor
			},
		})
		super(ctx, env)
	}

	async rowsRead(): Promise<number> {
		settle()
		return settled
	}

	// An agent's message, as a run posts it: the chat's unread count grows without a human send.
	async agentChatter(count: number): Promise<void> {
		for (let i = 0; i < count; i++) await this.post("ada" as never, `chatter-${i}`, 0, 0, `agent line ${i}`)
	}
}

type Env = { ROOM: DurableObjectNamespace<RoomDO>; USER: DurableObjectNamespace<UserDO> }

export default {
	async fetch(request: Request, env: Env) {
		const [, kind, roomId] = new URL(request.url).pathname.split("/")
		const stub = env.ROOM.get(env.ROOM.idFromName(`room:alice:${roomId}`))
		if (kind === "reads") return Response.json(await stub.rowsRead())
		if (kind === "chatter") {
			await stub.agentChatter(Number(await request.text()))
			return new Response("ok")
		}
		const headers = new Headers(request.headers)
		headers.set(USER_ID_HEADER, "alice")
		headers.set(ROOM_ID_HEADER, roomId!)
		return stub.fetch(new Request(request, { headers }))
	},
}
