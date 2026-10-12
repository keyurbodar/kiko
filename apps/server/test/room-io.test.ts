import { afterAll, beforeAll, expect, test } from "bun:test"
import type { RoomToClient } from "@yuki/protocol"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

// Rows read and written per action, in a fresh room and in a room with history. Each action runs once in
// each room, in the same order. The large room holds 1,000 human messages, 1,000 agent bubbles, and 1,000
// files, the size a busy chat reaches in a few weeks.

type Cost = { read: number; written: number }
type Row = { action: string; small: Cost; large: Cost }

const SMALL_HUMANS = 4
const SMALL_AGENT = 2
const SMALL_FILES = 3
const LARGE_HUMANS = 1000
const LARGE_AGENT = 1000
const LARGE_FILES = 1000
// A burst flushes AFTER_MESSAGE_MS (1 s) after its last message, then delivers.
const FLUSH_MS = 3_500
const SETTLE_MS = 300

// Every event that touches the chat list reads up to MENTION_SCAN (500) unread agent messages: U90's bound
// (room-send-reads.test.ts). A budget that allows that scan plus a constant is flat in the way that matters.
const MENTION_SCAN_BOUND = 1000

// Rows read in the large room, at most, per action. Each bound is the design's cost, not a measured value.
const READ_BOUNDS: Record<string, number> = {
	send: MENTION_SCAN_BOUND,
	"react (human)": MENTION_SCAN_BOUND,
	edit: MENTION_SCAN_BOUND,
	delete: MENTION_SCAN_BOUND,
	"memory recall": 300, // about 30 hits, two constant lookups each
	"agent run ends (trace, answer)": 200, // the run's turn is found by key
	"memory since (last 20 turns)": 300,
	"reconnect (replay 5)": 100,
	"read one new": 100,
	"agent bubble post": 100,
	"agent reacts": 100,
	"file put (one file)": 100,
	"alarm (nothing due)": 100,
	typing: 10,
	"agent typing on": 10,
	search: 300,
	"history (50 before, 50 after)": 300,
	"task create": 300,
}

let mf: Miniflare
let origin: string

beforeAll(async () => {
	mf = new Miniflare({
		modules: true,
		script: await bundleWorker(new URL("./room-io-worker.ts", import.meta.url)),
		compatibilityDate: "2026-07-01",
		compatibilityFlags: ["nodejs_compat"],
		durableObjects: {
			ROOM: { className: "RoomDO", useSQLite: true },
			USER: { className: "UserDO", useSQLite: true },
			AGENT: { className: "AgentDO", useSQLite: true },
		},
	})
	origin = (await mf.ready).origin
}, 60_000)

afterAll(async () => {
	await mf?.dispose()
})

async function call(room: string, method: string, ...args: unknown[]): Promise<unknown> {
	const res = await fetch(`${origin}/call/${room}/${method}`, { method: "POST", body: JSON.stringify(args) })
	if (!res.ok) throw new Error(`${method}: ${res.status} ${await res.text()}`)
	return res.json()
}

async function counts(room: string): Promise<Cost> {
	return (await (await fetch(`${origin}/counts/${room}`)).json()) as Cost
}

async function until(done: () => boolean, ms = 20_000): Promise<void> {
	for (let t = 0; t < ms && !done(); t += 5) await Bun.sleep(5)
}

type Socket = { ws: WebSocket; frames: RoomToClient[]; send(frame: unknown): void }

async function open(room: string): Promise<Socket> {
	const ws = new WebSocket(`${origin.replace(/^http/, "ws")}/ws/${room}`)
	const frames: RoomToClient[] = []
	ws.onmessage = (e) => frames.push(JSON.parse(String(e.data)))
	await new Promise((resolve, reject) => {
		ws.onopen = resolve
		ws.onerror = reject
	})
	return { ws, frames, send: (frame) => ws.send(JSON.stringify(frame)) }
}

type Ack = Extract<RoomToClient, { t: "ack" }>

async function sendText(sock: Socket, text: string): Promise<Ack> {
	const clientId = `c-${crypto.randomUUID()}`
	sock.send({ t: "send", clientId, text })
	await until(() => sock.frames.some((f) => f.t === "ack" && f.clientId === clientId))
	return sock.frames.find((f): f is Ack => f.t === "ack" && f.clientId === clientId)!
}

// Rows read and written by `act`, from the room's counters. Work the action starts in the background gets
// `after` ms to finish before the second reading.
async function measure(room: string, act: () => Promise<unknown>, after = SETTLE_MS): Promise<Cost> {
	await Bun.sleep(SETTLE_MS)
	const before = await counts(room)
	await act()
	await Bun.sleep(after)
	const now = await counts(room)
	return { read: now.read - before.read, written: now.written - before.written }
}

// Seeds a room. Returns the first human message, which the reactions below point at.
async function fill(room: string, sock: Socket, humans: number, agents: number, files: number): Promise<Ack> {
	const first: Ack[] = []
	for (let block = 0; block < humans; block += 100) {
		const acks: Promise<Ack>[] = []
		for (let i = block; i < Math.min(block + 100, humans); i++) acks.push(sendText(sock, `message ${i} about nothing in particular`))
		first.push(...(await Promise.all(acks)).slice(0, 1))
	}
	for (let i = 0; i < agents; i++) await call(room, "post", "ada", `seed-run-${i}`, 0, 0, `agent line ${i} about the plan`)
	for (let i = 0; i < files; i++) {
		await call(room, "putFile", { id: `f${i}`, path: `docs/file-${i}.md`, r2Key: `r2-${i}`, size: 10, type: "text/markdown", sha256: `sha-${i}`, author: { kind: "human" }, expectSha256: "none" })
	}
	return first[0]!
}

async function actions(room: string, humans: number, agents: number, files: number): Promise<Map<string, Cost>> {
	const out = new Map<string, Cost>()
	const live = await open(room)
	live.send({ t: "hello", lastSeq: 0 })
	await until(() => live.frames.some((f) => f.t === "events" || f.t === "reset"))
	live.send({ t: "member", op: { op: "add", slug: "ada", name: "Ada" } })
	await Bun.sleep(SETTLE_MS)

	const firstHuman = await fill(room, live, humans, agents, files)
	await Bun.sleep(FLUSH_MS)
	const head = live.frames.flatMap((f) => (f.t === "events" ? f.events.map((e) => e.seq) : [])).sort((a, b) => b - a)[0] ?? 0

	out.set("open chat (snapshot)", await measure(room, async () => {
		const sock = await open(room)
		sock.send({ t: "hello", lastSeq: 0 })
		await until(() => sock.frames.some((f) => f.t === "reset" || f.t === "events"))
		sock.ws.close()
	}))
	out.set("reconnect (replay 5)", await measure(room, async () => {
		const sock = await open(room)
		sock.send({ t: "hello", lastSeq: Math.max(0, head - 5) })
		await until(() => sock.frames.some((f) => f.t === "reset" || f.t === "events"))
		sock.ws.close()
	}))

	let sent: Ack | undefined
	out.set("send", await measure(room, async () => {
		sent = await sendText(live, "a new note for the agent")
	}))
	out.set("burst flush and delivery", await measure(room, () => Bun.sleep(FLUSH_MS)))
	// The first view syncs the chat's turns, which the seeding has not done: a one-time cost per chat. It arms
	// the memory naps (two seconds later, a first pass), so its window runs long enough to hold that pass. The
	// actions after it see a synced, quiet chat.
	let synced = { count: 0 }
	out.set("memory first view (syncs the chat, first naps)", await measure(room, async () => {
		synced = (await call(room, "memoryView", [])) as { count: number }
	}, 4_000))
	const mine = sent!

	out.set("typing", await measure(room, async () => live.send({ t: "typing" })))
	out.set("react (human)", await measure(room, async () => live.send({ t: "react", messageId: mine.id, emoji: "👍" })))
	out.set("edit", await measure(room, async () => live.send({ t: "edit", messageId: mine.id, text: "a new note, edited" })))
	out.set("search", await measure(room, async () => {
		live.send({ t: "search", query: "message", limit: 20 })
		await until(() => live.frames.some((f) => f.t === "search"))
	}))
	out.set("history (50 before, 50 after)", await measure(room, async () => {
		live.send({ t: "history", seq: Math.max(1, head - 100), before: 50, after: 50 })
		await until(() => live.frames.some((f) => f.t === "history"))
	}))
	out.set("read to latest (catch-up)", await measure(room, async () => live.send({ t: "read", seq: head + 1000 })))
	await call(room, "post", "ada", "read-one", 0, 0, "one more line")
	out.set("read one new", await measure(room, async () => live.send({ t: "read", seq: head + 2000 })))
	out.set("delete", await measure(room, async () => live.send({ t: "delete", messageId: mine.id })))

	out.set("agent bubble post", await measure(room, async () => call(room, "post", "ada", "bubble-run", 0, 0, "a bubble")))
	out.set("agent reacts", await measure(room, async () => call(room, "react", "ada", "👀", firstHuman.id)))
	out.set("agent typing on", await measure(room, async () => call(room, "setTyping", "ada", true)))
	await call(room, "reportDoing", "ada", "reading the chat")
	await call(room, "post", "ada", "end-run", 0, 0, "the answer")
	out.set("agent run ends (trace, answer)", await measure(room, async () => call(room, "endRun", "ada", "end-run", [], false)))
	out.set("memory recall", await measure(room, async () => call(room, "memoryRecall", "plan agent line", undefined, [])))
	out.set("memory since (last 20 turns)", await measure(room, async () => call(room, "memorySince", "ada", Math.max(0, synced.count - 20), [])))
	out.set("memory view (whole room)", await measure(room, async () => call(room, "memoryView", [])))
	out.set("alarm (nothing due)", await measure(room, async () => call(room, "wake")))
	out.set("file put (one file)", await measure(room, async () => call(room, "putFile", { id: "new-one", path: "docs/new.md", r2Key: "r2-new", size: 10, type: "text/markdown", sha256: "sha-new", author: { kind: "human" }, expectSha256: "none" })))
	out.set("folder stat (docs)", await measure(room, async () => call(room, "fsStat", "docs")))
	out.set("folder list (docs)", await measure(room, async () => call(room, "fsList", "docs")))
	out.set("task create", await measure(room, async () => live.send({ t: "task", op: { op: "create", id: "task-one", title: "a task" } })))

	live.ws.close()
	return out
}

const rows: Row[] = []

test("rows read and written per action, in a fresh room and a room with history", async () => {
	const small = await actions("01JZ9IO0SMALLROOMIO000001", SMALL_HUMANS, SMALL_AGENT, SMALL_FILES)
	const large = await actions("01JZ9IO0LARGEROOMIO000001", LARGE_HUMANS, LARGE_AGENT, LARGE_FILES)
	for (const [action, cost] of small) rows.push({ action, small: cost, large: large.get(action)! })

	const table = [
		"| action | rows read (small) | rows written (small) | rows read (large) | rows written (large) |",
		"| --- | ---: | ---: | ---: | ---: |",
		...rows.map((r) => `| ${r.action} | ${r.small.read} | ${r.small.written} | ${r.large.read} | ${r.large.written} |`),
	]
	console.log(table.join("\n"))

	const over = Object.entries(READ_BOUNDS).flatMap(([action, bound]) => {
		const row = rows.find((r) => r.action === action)
		return !row || row.large.read > bound ? [`${action}: ${row?.large.read ?? "missing"} rows read at history, bound ${bound}`] : []
	})
	expect(over).toEqual([])
}, 900_000)

// The lookups that grow with history. Each must find its rows by an index, not a scan of the table.
const PLANNED: Record<string, string> = {
	"a run's turn by key": "SELECT pos FROM mem_turns WHERE key = ?",
	"the turn holding a message": "SELECT pos, last_seq FROM mem_turns WHERE first_seq <= ? ORDER BY first_seq DESC LIMIT 1",
	"the deliveries sweep": "DELETE FROM deliveries WHERE at < ?",
}

for (const [name, query] of Object.entries(PLANNED)) {
	test(`${name} uses an index, not a scan`, async () => {
		const plan = (await call("01JZ9IO0PLANROOMIO000001", "plan", query, 0)) as string[]
		expect(plan.join("\n")).not.toMatch(/\bSCAN\b/)
	})
}
