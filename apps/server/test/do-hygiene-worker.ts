import { DurableObject } from "cloudflare:workers"
import { ROOM_ID_HEADER, USER_ID_HEADER } from "../src/lib/names"
import { RoomDO as Room } from "../src/room/room-do"
import { UserDO as User } from "../src/user/user-do"

// The room calls UserDO after a send or a run. A stub that accepts those calls keeps them on the path.
export class UserStub extends DurableObject {
	async recordRoom(): Promise<boolean> {
		return true
	}
	async touchChat(): Promise<void> {}
	async chatTasks(): Promise<void> {}
	async chatTyping(): Promise<void> {}
	async forgetMessages(): Promise<void> {}
	async captureHuman(): Promise<void> {}
	async getChat(): Promise<null> {
		return null
	}
}

// Rows read and written by every statement, plus one write for each key-value put or delete and each alarm set
// or cleared: the platform bills those too. A cursor is drained when the total is asked for, so a statement
// the caller left half read still counts in full.
function meter(ctx: DurableObjectState) {
	const open: SqlStorageCursor<Record<string, SqlStorageValue>>[] = []
	const total = { read: 0, written: 0 }
	const settle = () => {
		for (const cursor of open.splice(0)) {
			for (const _ of cursor) {
				// Drain the rest: the counts are final once the cursor is exhausted.
			}
			total.read += cursor.rowsRead
			total.written += cursor.rowsWritten
		}
	}
	const sql = ctx.storage.sql
	const exec = sql.exec.bind(sql)
	Object.defineProperty(sql, "exec", {
		configurable: true,
		value: (query: string, ...bindings: SqlStorageValue[]) => {
			const cursor = exec(query, ...bindings)
			if (open.length > 10_000) settle()
			open.push(cursor)
			return cursor
		},
	})
	const storage = ctx.storage as unknown as Record<string, (...a: unknown[]) => unknown>
	for (const name of ["put", "delete", "setAlarm", "deleteAlarm"]) {
		const original = storage[name]!.bind(ctx.storage)
		Object.defineProperty(ctx.storage, name, {
			configurable: true,
			value: (...args: unknown[]) => {
				total.written++
				return original(...args)
			},
		})
	}
	return () => {
		settle()
		return { ...total }
	}
}

export class RoomDO extends Room {
	#counts: () => { read: number; written: number }
	constructor(ctx: DurableObjectState, env: ConstructorParameters<typeof Room>[1]) {
		const counts = meter(ctx)
		super(ctx, env)
		this.#counts = counts
	}
	async counts() {
		return this.#counts()
	}
	async wake(): Promise<void> {
		await this.alarm()
	}
}

export class UserDO extends User {
	#counts: () => { read: number; written: number }
	constructor(ctx: DurableObjectState, env: ConstructorParameters<typeof User>[1]) {
		const counts = meter(ctx)
		super(ctx, env)
		this.#counts = counts
	}
	async counts() {
		return this.#counts()
	}
	async wake(): Promise<void> {
		await this.alarm()
	}
	async plan(query: string, ...args: SqlStorageValue[]): Promise<string[]> {
		return this.ctx.storage.sql.exec<{ detail: string }>(`EXPLAIN QUERY PLAN ${query}`, ...args).toArray().map((r) => r.detail)
	}
}

type Env = { ROOM: DurableObjectNamespace<RoomDO>; USER: DurableObjectNamespace<UserStub>; OWNER: DurableObjectNamespace<UserDO> }

// /room/<id>/ws, /room/<id>/counts, /room/<id>/wake and POST /room/<id>/call/<method> reach a room.
// /user/ws, /user/counts and /user/wake reach the owner's user object.
export default {
	async fetch(request: Request, env: Env) {
		const [, kind, ...rest] = new URL(request.url).pathname.split("/")
		if (kind === "user") {
			const stub = env.OWNER.get(env.OWNER.idFromName("user:alice"))
			if (rest[0] === "counts") return Response.json(await stub.counts())
			if (rest[0] === "wake") return Response.json(await stub.wake())
			return stub.fetch(request)
		}
		const [roomId, op, method] = rest
		const stub = env.ROOM.get(env.ROOM.idFromName(`room:alice:${roomId}`))
		if (op === "counts") return Response.json(await stub.counts())
		if (op === "wake") return Response.json(await stub.wake())
		if (op === "call") {
			const args = (await request.json()) as unknown[]
			const target = stub as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>
			return Response.json((await target[method!]!(...args)) ?? null)
		}
		const headers = new Headers(request.headers)
		headers.set(USER_ID_HEADER, "alice")
		headers.set(ROOM_ID_HEADER, roomId!)
		return stub.fetch(new Request(request, { headers }))
	},
}
