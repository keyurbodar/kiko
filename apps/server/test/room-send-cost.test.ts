import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import type { Sender } from "@kiko/protocol"
import { RoomLog } from "../src/room/log"
import { ROOM_STEPS } from "../src/room/schema"
import { sqlWith } from "./sql-shim"

// The per-send queries and the indexes they need. A query that scans the burst window or the whole log fails here
// before a load test finds it.

function setup() {
	const db = new Database(":memory:")
	const sql = sqlWith(ROOM_STEPS, db)
	const storage = { sql, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage
	let at = 0
	return { db, log: new RoomLog(storage, () => ++at), storage }
}

// The count the chat showed before the count was kept: every live non-human message after the read mark.
function countedUnread(db: Database): number {
	return db
		.query<{ n: number }, []>(
			`SELECT count(*) AS n FROM messages WHERE deleted_at IS NULL AND seq > COALESCE((SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'read_seq'), 0) AND json_extract(sender, '$.kind') != 'human'`,
		)
		.get()!.n
}

test("the kept unread count equals a count of the chat after every kind of change", () => {
	const { db, log } = setup()
	const human: Sender = { kind: "human" }
	const ada: Sender = { kind: "agent", slug: "ada" } as Sender
	const check = () => expect(log.unread()).toBe(countedUnread(db))

	const first = log.addMessage({ from: human, text: "hi" })
	check()
	log.addMessage({ from: ada, text: "one" })
	log.addMessage({ from: ada, text: "two" })
	const three = log.addMessage({ from: ada, text: "three" })
	check()
	log.markRead(first.seq + 1)
	check()
	log.addMessage({ from: ada, text: "four" })
	check()
	log.deleteMessages([three.id], human)
	check()
	const five = log.addMessage({ from: ada, text: "five" })
	log.deleteMessages([five.id], human)
	check()
	log.markRead(999)
	check()
	log.markRead(1)
	check()
	log.addMessage({ from: human, text: "mine" })
	check()
	log.deleteMessages([first.id], human)
	check()
})

test("a chat that was never counted is counted once, when first asked, and then kept", () => {
	const { db, log, storage } = setup()
	const ada: Sender = { kind: "agent", slug: "ada" } as Sender
	log.addMessage({ from: ada, text: "before the count" })
	log.addMessage({ from: ada, text: "also before" })
	expect(db.query("SELECT value FROM meta WHERE key = 'unread'").get()).toBeNull()
	expect(log.unread()).toBe(2)
	log.addMessage({ from: ada, text: "after" })
	expect(log.unread()).toBe(3)
	expect(new RoomLog(storage).unread()).toBe(3)
})

test("the per-send plans read the burst window in seq order and its start through the at index", () => {
	const { db } = setup()
	const now = Date.now()
	db.exec("BEGIN")
	for (let i = 0; i < 3000; i++) db.query("INSERT INTO pending (id, seq, at, text, mentions) VALUES (?, ?, ?, ?, '[]')").run(`m${i}`, 10_000 + i, now + i, "x")
	db.exec("COMMIT")
	db.exec("ANALYZE")
	const plan = (query: string, ...args: (string | number)[]) =>
		db.query<{ detail: string }, (string | number)[]>(`EXPLAIN QUERY PLAN ${query}`).all(...args).map((r) => r.detail).join(" | ")

	const envelopes = plan("SELECT id, seq, at, text, reply_to, mentions FROM pending ORDER BY seq LIMIT ?", 100)
	expect(envelopes).toContain("USING INDEX pending_seq")
	expect(envelopes).not.toContain("TEMP B-TREE")
	// The window's start reads the lowest seq, which pending_seq already orders, so it needs no second index.
	const start = plan("SELECT at FROM pending ORDER BY seq LIMIT 1")
	expect(start).toContain("USING INDEX pending_seq")
	expect(start).not.toContain("SCAN pending\n")
})
