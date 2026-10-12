import { UserDO as User } from "../src/user/user-do"

// Every statement's cursor, read once when a test asks for the totals. A cursor's counts are final once it
// has run, and the test reads them only between actions.
const open: SqlStorageCursor<Record<string, SqlStorageValue>>[] = []
let read = 0
let written = 0

function settle(): void {
	for (const cursor of open.splice(0)) {
		read += cursor.rowsRead
		written += cursor.rowsWritten
	}
}

export class UserDO extends User {
	constructor(ctx: DurableObjectState, env: ConstructorParameters<typeof User>[1]) {
		const sql = ctx.storage.sql
		const exec = sql.exec.bind(sql)
		Object.defineProperty(sql, "exec", {
			configurable: true,
			value: (query: string, ...bindings: SqlStorageValue[]) => {
				const cursor = exec(query, ...bindings)
				open.push(cursor)
				if (open.length > 10_000) settle()
				return cursor
			},
		})
		super(ctx, env)
	}

	async counts(): Promise<{ read: number; written: number }> {
		settle()
		return { read, written }
	}

	// Runs one user action and returns the rows it read and wrote. The action is a method of UserDO.
	async measure(op: string, args: unknown[]): Promise<{ read: number; written: number }> {
		await this.counts()
		const before = { read, written }
		await (this as unknown as Record<string, (...a: unknown[]) => unknown>)[op]!(...args)
		const after = await this.counts()
		return { read: after.read - before.read, written: after.written - before.written }
	}

	// The life log's nearest lines, as a capture pass asks for them: the same read the pass makes per heard line.
	async lifeNearest(text: string): Promise<number> {
		return ((this as unknown as { life: { nearest(text: string, limit: number): unknown[] } }).life.nearest(text, 12)).length
	}

	// History, written straight into the tables so a large object is cheap to build. Each kind adds `n` rows and
	// returns how many it added, so the test can check the seed built what it asked for.
	async seed(kind: SeedKind, n: number): Promise<number> {
		const sql = this.ctx.storage.sql
		const now = Date.now()
		const count = () => sql.exec<{ n: number }>(`SELECT count(*) AS n FROM ${TABLE[kind]}`).one().n
		const before = count()
		// The series' only `?` is the row count, so every insert binds n first. A recursive count bound to a timestamp
		// runs for trillions of rows and filled the WAL in seconds.
		const series = "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?) "
		const insert = (body: string, ...binds: SqlStorageValue[]) => sql.exec(`${series}${body}`, n, ...binds)
		if (kind === "life") {
			insert(
				`INSERT INTO life (pos, at, text, source, norm, card) SELECT i, ?, 'tok' || i, 'ada', 'tok' || i, CASE WHEN i % 50 = 0 THEN 'ATTRIBUTE' END FROM n`,
				now,
			)
			insert(`INSERT INTO life_fts (rowid, text) SELECT i, 'tok' || i FROM n`)
			insert(`INSERT INTO life_tri (rowid, text) SELECT i, 'tok' || i FROM n`)
		} else if (kind === "chats") {
			insert(`INSERT INTO chats (room_id, title, updated_at) SELECT 'r' || i, 'chat ' || i, ? FROM n`, now)
		} else if (kind === "reminders") {
			insert(
				`INSERT INTO reminders (id, text, due_utc, tz, rrule, room_id, target, created_by, status, last_fired, created_at) SELECT 'done' || i, 'old ' || i, ?, 'UTC', NULL, 'r1', 'human', 'human', 'done', ?, ? FROM n`,
				now - 86_400_000,
				now - 86_400_000,
				now - 86_400_000,
			)
		} else if (kind === "loops") {
			insert(
				`INSERT INTO loops (kind, certainty, owner, room, ref, status, text, norm, source, opened_at, last_seen) SELECT 'goal', 'explicit', 'human', 'r1', 'ref' || i, 'done', 'old loop ' || i, 'old loop ' || i, 'tool', ?, ? FROM n`,
				now,
				now,
			)
		} else if (kind === "marks") {
			insert(`INSERT INTO initiative_marks (id, surfaced, last_at) SELECT 'loop:' || i, 1, ? FROM n`, now)
		} else if (kind === "seen") {
			// A week of bursts, each seen once: rows the window keeps until they age out.
			insert(`INSERT INTO attention_seen (id, at) SELECT 'burst:r1:' || i, ? - i * 60000 FROM n`, now)
		} else if (kind === "capture") {
			insert(`INSERT INTO capture_queue (room_id, message_id, text, at, queued_at) SELECT 'r1', 'q' || i, 'queued line ' || i, ?, ? FROM n`, now, now)
		}
		return count() - before
	}
}

type SeedKind = "life" | "chats" | "reminders" | "loops" | "marks" | "capture" | "seen"
const TABLE: Record<SeedKind, string> = {
	life: "life",
	chats: "chats",
	reminders: "reminders",
	loops: "loops",
	marks: "initiative_marks",
	seen: "attention_seen",
	capture: "capture_queue",
}

type Env = { USER: DurableObjectNamespace<UserDO> }

// The user object is named for the test's user. Each request runs one step: `/op/<user>` takes a JSON body
// of the action and its arguments, and `/seed/<user>` builds history.
export default {
	async fetch(request: Request, env: Env) {
		const [, kind, user] = new URL(request.url).pathname.split("/")
		const stub = env.USER.get(env.USER.idFromName(`user:${user}`))
		if (kind === "seed") {
			const { what, n } = (await request.json()) as { what: Parameters<UserDO["seed"]>[0]; n: number }
			return Response.json(await stub.seed(what, n))
		}
		const { op, args } = (await request.json()) as { op: string; args: unknown[] }
		try {
			return Response.json(await stub.measure(op, args))
		} catch (error) {
			return new Response(String(error), { status: 500 })
		}
	},
}

