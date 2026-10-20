import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { OWNER_STEPS } from "../src/owner/schema"
import { sqlWith } from "./sql-shim"

type Binding = string | number | null

type LogQuery = {
	name: string
	sql: string
	args: Binding[]
	table: string
	bounds: string[]
	seqs: number[]
	allowSort?: boolean
}

const ROOM = "room-a"
const OTHER_ROOM = "room-b"
const db = new Database(":memory:")
const id = (seq: number) => `message-${seq}`
const run = (seq: number) => `run-${Math.floor((seq - 1) / 4)}`

function plan(query: string, args: Binding[]): string[] {
	return db.query<{ detail: string }, Binding[]>(`EXPLAIN QUERY PLAN ${query}`).all(...args).map((row) => row.detail)
}

function expectSearch(details: string[], table: string, bounds: string[]): void {
	const access = details.filter((detail) => new RegExp(`\\b(?:SEARCH|SCAN) ${table}\\b`).test(detail))
	expect(access.length, details.join("\n")).toBeGreaterThan(0)
	for (const detail of access) {
		expect(detail).toContain(`SEARCH ${table} USING`)
		const constraints = detail.slice(detail.lastIndexOf("(") + 1, -1).split(" AND ")
		for (const bound of bounds) expect(constraints, detail).toContain(bound)
	}
}

beforeAll(() => {
	sqlWith(OWNER_STEPS, db)
	const message = db.query(`INSERT INTO messages
		(room_id, seq, id, at, sender, text, run_id, run_attempt, run_index, deleted_at, addressed, event)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	const event = db.query("INSERT INTO events (room_id, seq, kind, at, actor, payload) VALUES (?, ?, ?, ?, 'human', '{}')")
	const reaction = db.query("INSERT INTO reactions (room_id, message_id, actor, emoji, at) VALUES (?, ?, ?, ?, ?)")
	const client = db.query("INSERT INTO clients (room_id, client_id, message_id, seq) VALUES (?, ?, ?, ?)")
	const step = db.query(`INSERT INTO run_steps
		(room_id, run_id, id, slug, tool, name, label, status, started_at, ended_at, after_seq)
		VALUES (?, ?, ?, 'ada', 'read', 'read_file', 'Read a file', 'done', ?, ?, ?)`)

	db.transaction(() => {
		for (let seq = 1; seq <= 10_000; seq++) {
			for (const room of [OTHER_ROOM, ROOM]) {
				const text = seq % 1000 === 0 ? `needle at ${seq}` : `ordinary message ${seq}`
				message.run(
					room, seq, id(seq), 1_000_000 + seq,
					JSON.stringify(seq % 2 ? { kind: "human" } : { kind: "agent", slug: "ada" }),
					text, run(seq), seq % 4 < 2 ? 1 : 2, (seq - 1) % 2,
					seq % 97 === 0 ? 2_000_000 : null,
					seq === 8000 ? "ada" : null,
					seq === 9000 ? '{"kind":"notice","private":true}' : null,
				)
				event.run(room, seq, seq === 9993 ? "edit" : seq === 9994 ? "react" : seq === 9995 ? "delete" : "message", 1_000_000 + seq)
				client.run(room, `client-${seq}`, id(seq), seq)
				if (seq % 50 === 0) {
					step.run(room, run(seq), `step-${seq}`, 1_000_000 + seq, 1_000_001 + seq, seq - 1)
					reaction.run(room, id(seq), "human", room === ROOM ? "yes" : "other", 1_000_000 + seq)
					reaction.run(room, id(seq), "agent:ada", "ok", 999_999 + seq)
				}
			}
		}
	})()
	db.exec("ANALYZE")
})

afterAll(() => db.close())

const queries: LogQuery[] = [
	{
		name: "message id lookup does not walk the room sequence key",
		sql: "SELECT * FROM messages WHERE room_id = ? AND id = ? AND deleted_at IS NULL",
		args: [ROOM, id(5000)], table: "messages", bounds: ["room_id=?", "id=?"], seqs: [5000],
	},
	{
		name: "reply previews use one JSON binding and indexed id lookups",
		sql: "SELECT * FROM messages WHERE room_id = ? AND id IN (SELECT value FROM json_each(?)) ORDER BY seq",
		args: [ROOM, JSON.stringify([id(5000), id(5001), id(5044)])],
		table: "messages", bounds: ["room_id=?", "id=?"], seqs: [5000, 5001, 5044], allowSort: true,
	},
	{
		name: "run bubble dedupe looks up the complete run key",
		sql: "SELECT * FROM messages WHERE room_id = ? AND run_id = ? AND run_attempt = ? AND run_index = ?",
		args: [ROOM, run(5000), 1, 1], table: "messages",
		bounds: ["room_id=?", "run_id=?", "run_attempt=?", "run_index=?"], seqs: [5000],
	},
	{
		name: "earlier run attempts seek the run before sorting its bubbles by sequence",
		sql: "SELECT * FROM messages WHERE room_id = ? AND run_id = ? AND run_attempt < ? AND run_index >= ? AND deleted_at IS NULL ORDER BY seq",
		args: [ROOM, run(5000), 2, 0], table: "messages",
		bounds: ["room_id=?", "run_id=?", "run_attempt<?"], seqs: [4997, 5000], allowSort: true,
	},
	{
		name: "bubble adoption seeks earlier attempts of the run before comparing its content",
		sql: "SELECT * FROM messages WHERE room_id = ? AND run_id = ? AND run_attempt < ? AND run_index = ? AND text = ? AND reply_to IS ? AND deleted_at IS NULL",
		args: [ROOM, run(5000), 2, 1, "needle at 5000", null], table: "messages",
		bounds: ["room_id=?", "run_id=?", "run_attempt<?"], seqs: [5000],
	},
	{
		name: "older cursor seeks into the middle of the room and skips a deletion hole",
		sql: "SELECT * FROM messages WHERE room_id = ? AND seq < ? AND deleted_at IS NULL ORDER BY seq DESC LIMIT ?",
		args: [ROOM, 5047, 4], table: "messages", bounds: ["room_id=?", "seq<?"], seqs: [5046, 5045, 5043, 5042],
	},
	{
		name: "newer cursor includes its live anchor and skips a deletion hole",
		sql: "SELECT * FROM messages WHERE room_id = ? AND seq >= ? AND deleted_at IS NULL ORDER BY seq LIMIT ?",
		args: [ROOM, 5042, 4], table: "messages", bounds: ["room_id=?", "seq>?"], seqs: [5042, 5043, 5045, 5046],
	},
	{
		name: "snapshot reads only the room tail before reversing its bounded page",
		sql: "SELECT seq FROM (SELECT * FROM messages WHERE room_id = ? AND deleted_at IS NULL ORDER BY seq DESC LIMIT ?) ORDER BY seq",
		args: [ROOM, 4], table: "messages", bounds: ["room_id=?"], seqs: [9997, 9998, 9999, 10000], allowSort: true,
	},
	{
		name: "last agent message uses the room key without messages_agent",
		sql: "SELECT * FROM messages WHERE room_id = ? AND json_extract(sender, '$.kind') = 'agent' AND json_extract(sender, '$.slug') = ? AND addressed IS NULL ORDER BY seq DESC LIMIT 1",
		args: [ROOM, "ada"], table: "messages", bounds: ["room_id=?"], seqs: [10000],
	},
	{
		name: "replay starts after its cursor in the selected room",
		sql: "SELECT seq, at, payload FROM events WHERE room_id = ? AND seq > ? ORDER BY seq",
		args: [ROOM, 9996], table: "events", bounds: ["room_id=?", "seq>?"], seqs: [9997, 9998, 9999, 10000],
	},
	{
		name: "edit replay can use the sequence key without events_edit",
		sql: "SELECT seq, kind, payload FROM events WHERE room_id = ? AND seq > ? AND kind IN ('edit', 'delete') ORDER BY seq",
		args: [ROOM, 9990], table: "events", bounds: ["room_id=?", "seq>?"], seqs: [9993, 9995],
	},
	{
		name: "reaction replay can use the sequence key without events_react",
		sql: "SELECT seq, kind, payload FROM events WHERE room_id = ? AND seq > ? AND kind = 'react' ORDER BY seq",
		args: [ROOM, 9990], table: "events", bounds: ["room_id=?", "seq>?"], seqs: [9994],
	},
	{
		name: "client resend dedupe uses its room and client key",
		sql: "SELECT seq FROM clients WHERE room_id = ? AND client_id = ?",
		args: [ROOM, "client-5000"], table: "clients", bounds: ["room_id=?", "client_id=?"], seqs: [5000],
	},
]

describe("proposed room SQL on OWNER_STEPS with 10k messages per room", () => {
	for (const query of queries) {
		test(query.name, () => {
			const details = plan(query.sql, query.args)
			expectSearch(details, query.table, query.bounds)
			if (!query.allowSort) expect(details.join("\n")).not.toContain("TEMP B-TREE")
			expect(db.query<{ seq: number }, Binding[]>(query.sql).all(...query.args).map((row) => row.seq)).toEqual(query.seqs)
		})
	}

	test("last event uses the room prefix of the sequence key", () => {
		const query = "SELECT max(seq) AS seq FROM events WHERE room_id = ?"
		expectSearch(plan(query, [ROOM]), "events", ["room_id=?"])
		expect(db.query<{ seq: number }, [string]>(query).get(ROOM)?.seq).toBe(10_000)
	})

	test("unread counting seeks to both sequence bounds without messages_not_human", () => {
		const query = `SELECT count(*) AS n FROM messages WHERE room_id = ? AND deleted_at IS NULL
			AND seq > ? AND seq <= ? AND json_extract(sender, '$.kind') != 'human'
			AND (event IS NULL OR json_extract(event, '$.private') IS NOT 1)`
		expectSearch(plan(query, [ROOM, 5040, 5050]), "messages", ["room_id=?", "seq>?", "seq<?"])
		expect(db.query<{ n: number }, Binding[]>(query).get(ROOM, 5040, 5050)?.n).toBe(4)
		expect(db.query<{ n: number }, Binding[]>(query).get(ROOM, 8998, 9002)?.n).toBe(1)
	})

	test("step counts use the room, agent, and opening-message key", () => {
		const query = "SELECT count(*) AS n FROM run_steps WHERE room_id = ? AND slug = ? AND after_seq = ?"
		expectSearch(plan(query, [ROOM, "ada", 4999]), "run_steps", ["room_id=?", "slug=?", "after_seq=?"])
		expect(db.query<{ n: number }, Binding[]>(query).get(ROOM, "ada", 4999)?.n).toBe(1)
	})

	test("reaction batches seek message keys and sort only the selected messages", () => {
		const query = `SELECT message_id, actor, emoji FROM reactions
			WHERE room_id = ? AND message_id IN (SELECT value FROM json_each(?)) ORDER BY at`
		const args = [ROOM, JSON.stringify([id(5000), id(5050)])]
		expectSearch(plan(query, args), "reactions", ["room_id=?", "message_id=?"])
		expect(db.query<{ message_id: string; actor: string; emoji: string }, string[]>(query).all(...args)).toEqual([
			{ message_id: id(5000), actor: "agent:ada", emoji: "ok" },
			{ message_id: id(5000), actor: "human", emoji: "yes" },
			{ message_id: id(5050), actor: "agent:ada", emoji: "ok" },
			{ message_id: id(5050), actor: "human", emoji: "yes" },
		])
	})
})

// Production room/search SQL still uses per-room tables and rowid joins.
// These remain explicit gaps until the parent wires the shared schema and chooses the FTS layout.
describe("pending production integration", () => {
	test.todo("capture RoomLog statements below the storage adapter and EXPLAIN the actual physical SQL")
	test.todo("reactionBrief correlated event and message joins use room keys before events_react is removed")
	test.todo("FTS MATCH drives indexed message lookups without messages.rowid")
	test.todo("search sequence cursor excludes its anchor and filters deleted, private, and addressed messages")
	test.todo("search time cursor is strict across overlapping room sequence numbers")
})
