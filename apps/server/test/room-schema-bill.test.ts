import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { KEEP_EVENTS } from "../src/room/log"
import { REBUILD_CLIENTS, ROOM_STEPS } from "../src/room/schema"
import { sqlWith } from "./sql-shim"

// A room's schema earns its write bill. Every row these statements write is billed against the account's daily
// allowance, so a table that can be WITHOUT ROWID must be, and an index that only serves a rare reader must be
// partial. These assertions fail when a step is added that puts a billed row back.
function setup() {
	const db = new Database(":memory:")
	const sql = sqlWith(ROOM_STEPS, db)
	return { db, sql }
}

const ddl = (db: Database, table: string): string =>
	db.query<{ sql: string | null }, [string]>("SELECT sql FROM sqlite_master WHERE name = ?").get(table)?.sql ?? ""

test("pending and clients store their row in the key, not beside it", () => {
	const { db } = setup()
	for (const table of ["pending", "clients", "run_steps", "mem_did"]) {
		expect(ddl(db, table)).toContain("WITHOUT ROWID")
	}
})

test("events does not carry AUTOINCREMENT", () => {
	const { db } = setup()
	// sqlite_sequence is written on every insert into an AUTOINCREMENT table, which is one billed row per event.
	// The table may still exist from before the rebuild, but nothing writes it once no table uses AUTOINCREMENT.
	expect(ddl(db, "events")).not.toContain("AUTOINCREMENT")
	// No table in the schema may reintroduce it.
	const autoinc = db
		.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE '%AUTOINCREMENT%'")
		.all()
	expect(autoinc.map((t) => t.name)).toEqual([])
})

test("no index is paid for a kind that almost never appears", () => {
	const { db } = setup()
	const indexes = db
		.query<{ name: string; sql: string | null }, []>("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'events'")
		.all()
	// Every events index must be partial. A message event is nearly all of the table and none of the readers want it.
	for (const index of indexes) expect(index.sql).toContain("WHERE")
	const names = indexes.map((i) => i.name)
	expect(names).toContain("events_react")
	expect(names).toContain("events_edit")
})

test("pending_at is gone and the window start reads through pending_seq", () => {
	const { db } = setup()
	const indexes = db
		.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'pending'")
		.all()
		.map((r) => r.name)
	expect(indexes).not.toContain("pending_at")
	expect(indexes).toContain("pending_seq")
	const plan = db
		.query<{ detail: string }, []>("EXPLAIN QUERY PLAN SELECT at FROM pending ORDER BY seq LIMIT 1")
		.all()
		.map((r) => r.detail)
		.join(" ")
	expect(plan).toContain("pending_seq")
}, 30_000)

test("the rebuilt tables keep working: a pending row, a client, an event, a react lookup", () => {
	const { db } = setup()
	db.exec("INSERT INTO pending (id, seq, at, text, mentions) VALUES ('m1', 7, 100, 'hi', '[]')")
	db.exec("INSERT INTO clients (client_id, message_id, seq) VALUES ('c1', 'm1', 7)")
	db.exec("INSERT INTO events (kind, at, actor, payload) VALUES ('message', 100, 'human', '{}')")
	db.exec("INSERT INTO events (kind, at, actor, payload) VALUES ('react', 101, 'agent:ada', '{}')")

	const pending = db.query<{ id: string; mentions: string }, []>("SELECT id, mentions FROM pending").get()!
	expect(pending.id).toBe("m1")
	expect(pending.mentions).toBe("[]")

	expect(db.query<{ seq: number }, []>("SELECT seq FROM events WHERE kind = 'react' ORDER BY seq DESC LIMIT 1").get()!.seq).toBe(2)
	expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM events WHERE seq > 1 AND kind IN ('edit','delete')").get()!.n).toBe(0)

	// A seq handed out once is never handed out again while the trim leaves the newest row, which it always does:
	// it deletes `seq - KEEP_EVENTS`, which is below the maximum. This is the invariant removing AUTOINCREMENT rests on.
	db.exec("INSERT INTO events (kind, at, actor, payload) VALUES ('message', 102, 'human', '{}')")
	expect(db.query<{ seq: number }, []>("SELECT max(seq) AS seq FROM events").get()!.seq).toBe(3)
})

test("rebuilding clients carries the replay window and drops what can never be read", () => {
	const db = new Database(":memory:")
	sqlWith(ROOM_STEPS, db)
	// clients had no trim before Phase 1, so an old room can hold one row per message it ever sent. A rebuild
	// that copied them all would write every one of those rows in a single transaction, which is a day's
	// allowance spent by one migration. Only the newest KEEP_EVENTS rows can still be asked for.
	db.exec("DELETE FROM clients")
	db.exec("DELETE FROM events")
	for (let s = 1; s <= 5000; s++) {
		db.exec(`INSERT INTO clients (client_id, message_id, seq) VALUES ('c${s}', 'm${s}', ${s})`)
		db.exec(`INSERT INTO events (seq, kind, at, actor, payload) VALUES (${s}, 'message', ${s}, 'human', '{}')`)
	}
	const rebuild = REBUILD_CLIENTS as (sql: SqlStorage) => void
	rebuild(sqlWith([], db))

	expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM clients").get()!.n).toBe(KEEP_EVENTS)
	expect(db.query<{ n: number }, []>("SELECT min(seq) AS n FROM clients").get()!.n).toBe(5000 - KEEP_EVENTS + 1)
	expect(ddl(db, "clients")).toContain("WITHOUT ROWID")
}, 30_000)
