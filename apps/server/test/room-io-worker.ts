import { DurableObject } from "cloudflare:workers"
import { ROOM_ID_HEADER, USER_ID_HEADER } from "../src/lib/names"
import { RoomDO as Room } from "../src/room/room-do"

// The room calls UserDO after a send, a read, a typing burst. A stub that accepts those calls keeps them on the path.
export class UserDO extends DurableObject {
	async recordRoom(): Promise<boolean> {
		return true
	}
	async touchChat(): Promise<void> {}
	async chatTasks(): Promise<void> {}
	async chatTyping(): Promise<void> {}
	async forgetMessages(): Promise<void> {}
	async loopsAnswer(): Promise<void> {}
	async captureHuman(): Promise<void> {}
	async getChat(): Promise<null> {
		return null
	}
	async takeTurn(): Promise<{ ok: true }> {
		return { ok: true }
	}
}

// A burst flush hands envelopes to the agent. The agent's own cost is measured in its object; here it only accepts them.
export class AgentDO extends DurableObject {
	async receive(): Promise<{ ok: true }> {
		return { ok: true }
	}
}

// Every statement's cursor. A cursor is drained when the total is asked for, so the rows a statement reads or
// writes are counted even when the caller used only part of its result.
const open: SqlStorageCursor<Record<string, SqlStorageValue>>[] = []
let read = 0
let written = 0

function settle(): void {
	for (const cursor of open.splice(0)) {
		for (const _ of cursor) {
			// Drain the rest: the statement's reads and writes are final once the cursor is exhausted.
		}
		read += cursor.rowsRead
		written += cursor.rowsWritten
	}
}

export class RoomDO extends Room {
	constructor(ctx: DurableObjectState, env: ConstructorParameters<typeof Room>[1]) {
		const sql = ctx.storage.sql
		const exec = sql.exec.bind(sql)
		Object.defineProperty(sql, "exec", {
			configurable: true,
			value: (query: string, ...bindings: SqlStorageValue[]) => {
				const cursor = exec(query, ...bindings)
				// Drain the older cursors, never the one the caller is about to read.
				if (open.length > 10_000) settle()
				open.push(cursor)
				return cursor
			},
		})
		super(ctx, env)
	}

	// The platform's alarm handler cannot be called over RPC, so the worker runs it through this method.
	async wake(): Promise<void> {
		await this.alarm()
	}

	// The query plan of a statement, one line per step. A step that scans a table shows as SCAN.
	async plan(query: string, ...args: SqlStorageValue[]): Promise<string[]> {
		return this.ctx.storage.sql.exec<{ detail: string }>(`EXPLAIN QUERY PLAN ${query}`, ...args).toArray().map((r) => r.detail)
	}

	async counts(): Promise<{ read: number; written: number }> {
		settle()
		return { read, written }
	}
}

type Env = { ROOM: DurableObjectNamespace<RoomDO>; USER: DurableObjectNamespace<UserDO>; AGENT: DurableObjectNamespace<AgentDO> }

// Routes: /ws/<room> is the room socket. /counts/<room> is the running total. POST /call/<room>/<method> calls a
// public room method with a JSON array of arguments, the way an agent's run does.
export default {
	async fetch(request: Request, env: Env) {
		const [, kind, roomId, method] = new URL(request.url).pathname.split("/")
		const stub = env.ROOM.get(env.ROOM.idFromName(`room:alice:${roomId}`))
		if (kind === "counts") return Response.json(await stub.counts())
		if (kind === "call") {
			const args = (await request.json()) as unknown[]
			const target = stub as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>
			const out = await target[method!]!(...args)
			return Response.json(out ?? null)
		}
		const headers = new Headers(request.headers)
		headers.set(USER_ID_HEADER, "alice")
		headers.set(ROOM_ID_HEADER, roomId!)
		return stub.fetch(new Request(request, { headers }))
	},
}
