import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

// An agent's rows read and written must not grow with its history. The inbox keeps seven days of messages, and
// the outbox keeps a row only while a run is open. Each test reads one action's rows at a small size and at a
// large one, and bounds the large one. The inbox bound fails on the code before the indexes: a turn read 3,265
// rows with 3,000 inbox rows.

let mf: Miniflare

beforeAll(async () => {
	mf = new Miniflare({
		modules: true,
		script: await bundleWorker(new URL("./agent-io-worker.ts", import.meta.url)),
		compatibilityDate: "2026-07-01",
		compatibilityFlags: ["nodejs_compat"],
		durableObjects: { T: { className: "T", useSQLite: true } },
	})
	await mf.ready
}, 60_000)

afterAll(async () => {
	await mf?.dispose()
})

type Row = { label: string; read: number; written: number; calls: number }
type Turn = { posted: number; rows: Row[] }

let turns = 0

async function agent(tps = 50) {
	const ns = await mf.getDurableObjectNamespace("T")
	const id = ns.newUniqueId()
	const call = async <R>(body: unknown): Promise<R> => {
		const res = await ns.get(id).fetch("http://do/", { method: "POST", body: JSON.stringify(body) })
		return (await res.json()) as R
	}
	await call({ op: "config", tps })
	return {
		turn: (text: string) => call<Turn>({ op: "turn", text, n: ++turns }),
		seed: (rows: number) => call<boolean>({ op: "seed", rows }),
		outboxRows: () => call<number>({ op: "outbox" }),
		reopen: () => call<Row[]>({ op: "reopen" }),
		prune: () => call<Row[]>({ op: "prune" }),
	}
}

const read = (rows: Row[]) => rows.reduce((sum, r) => sum + r.read, 0)
const wrote = (rows: Row[]) => rows.reduce((sum, r) => sum + r.written, 0)
const report = (action: string, rows: Row[]) => console.log(`ROW ${action} read=${read(rows)} written=${wrote(rows)}`)
const written = (rows: Row[], label: string) => rows.filter((r) => r.label === label).reduce((sum, r) => sum + r.calls, 0)

test("a turn reads about the same rows with 3,000 inbox rows as with none", async () => {
	const small = await agent()
	const fresh = await small.turn("hello")
	const inbox = await agent()
	await inbox.seed(3000)
	const large = await inbox.turn("hello")
	report("turn, fresh", fresh.rows)
	report("turn, 3,000 inbox rows", large.rows)
	expect(large.posted).toBe(1)
	expect(read(large.rows)).toBeLessThanOrEqual(read(fresh.rows) + 100)
}, 120_000)

test("an ended run leaves no outbox row, so the outbox stays as small as the open runs", async () => {
	const a = await agent()
	for (let i = 0; i < 5; i++) expect((await a.turn("hello")).posted).toBe(1)
	expect(await a.outboxRows()).toBe(0)
	const rows = await a.reopen()
	report("reopen, 5 ended runs", rows)
	expect(read(rows)).toBeLessThanOrEqual(300)
}, 120_000)

test("pruning the inbox reads the rows it deletes, not every submitted row", async () => {
	const a = await agent()
	await a.turn("hello")
	await a.seed(3000)
	const rows = await a.prune()
	report("prune, 3,000 submitted rows", rows)
	expect(read(rows)).toBeLessThanOrEqual(100)
}, 120_000)

test("a long transcript costs about the same as a short one", async () => {
	const a = await agent(2000)
	const short = await a.turn("hello")
	for (let i = 0; i < 20; i++) await a.turn("STREAM 2000")
	const long = await a.turn("hello")
	report("turn, short transcript", short.rows)
	report("turn, 20 turns of 2,000 characters", long.rows)
	expect(read(long.rows)).toBeLessThanOrEqual(read(short.rows) + 200)
}, 300_000)

test("a streamed answer writes a revision about every two seconds, not per token (25 is far below the ~1,000 tokens)", async () => {
	const a = await agent(50)
	// 4,000 characters at 50 tokens a second is about 20 seconds of stream.
	const stream = await a.turn("STREAM 4000")
	const revisions = written(stream.rows, "sql INSERT INTO document_revisions (document_id, seq, kind, version,")
	report("stream, 4,000 characters", stream.rows)
	expect(stream.posted).toBe(1)
	expect(revisions).toBeLessThanOrEqual(25)
}, 120_000)
