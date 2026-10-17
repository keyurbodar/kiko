import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

// Measurement only: prints rows read and written per user action, on a fresh object and on one with history.
let mf: Miniflare

beforeAll(async () => {
	mf = new Miniflare({
		modules: true,
		script: await bundleWorker(new URL("./user-reads-worker.ts", import.meta.url), { "process.env.NODE_ENV": '"development"' }),
		compatibilityDate: "2026-07-01",
		compatibilityFlags: ["nodejs_compat"],
		durableObjects: { USER: { className: "UserDO", useSQLite: true }, ROOM: { className: "RoomDO", useSQLite: true } },
		bindings: { SESSION_SECRET: "test-session-secret-at-least-32-chars", CREDENTIALS_KEK: "kek-test-user-reads" },
	})
	await mf.ready
}, 60_000)

afterAll(async () => {
	await mf?.dispose()
})

type Counts = { read: number; written: number }
async function call(user: string, op: string, args: unknown[]): Promise<Counts> {
	const res = await mf.dispatchFetch(`http://do/op/${user}`, { method: "POST", body: JSON.stringify({ op, args }) })
	if (!res.ok) throw new Error(`${op}: ${await res.text()}`)
	return (await res.json()) as Counts
}

// The seed reports how many rows it added. A wrong bind fails here, not as a runaway write.
async function seed(user: string, what: string, n: number): Promise<void> {
	const res = await mf.dispatchFetch(`http://do/seed/${user}`, { method: "POST", body: JSON.stringify({ what, n }) })
	expect(await res.json()).toBe(n)
}

const ROOM = "0199a000-0000-7000-8000-000000000001"
let step = 0

const ACTIONS: { name: string; op: string; args: () => unknown[] }[] = [
	{ name: "human burst: signals (one burst)", op: "signals", args: () => [{ roomId: ROOM, openedAt: Date.now(), more: 0, signals: [{ kind: "burst", roomId: ROOM, at: Date.now(), seq: ++step, text: "hi there", by: { kind: "human" } }] }] },
	{ name: "send: touchChat", op: "touchChat", args: () => [ROOM, { lastSeq: ++step, lastPreview: "hi", unread: 1 }] },
	{ name: "agent turn: turnContext", op: "turnContext", args: () => ["anthropic", "ada"] },
	{ name: "agent turn: lifeView", op: "lifeView", args: () => [] },
	{ name: "agent post: chatTasks (one open task)", op: "chatTasks", args: () => [ROOM, { open: 1, oldest: [{ id: "t1", title: "x", status: "doing", updatedAt: Date.now() - 4 * 3_600_000 }] }] },
	{ name: "chat list: listChats", op: "listChats", args: () => [] },
	{ name: "daily initiative pass", op: "devPass", args: () => [] },
	{ name: "capture pass: life nearest, earlier match found", op: "lifeNearest", args: () => ["remember tok2999 please"] },
	{ name: "capture pass: life nearest, no earlier match", op: "lifeNearest", args: () => ["i prefer tea over coffee"] },
]

async function measureAll(user: string): Promise<Record<string, Counts>> {
	const out: Record<string, Counts> = {}
	for (const a of ACTIONS) out[a.name] = await call(user, a.op, a.args())
	return out
}

test("rows read and written per user action, fresh and with history", async () => {
	await call("small", "createChat", [ROOM, "chat one"])
	const small = await measureAll("small")

	await call("large", "createChat", ["r-seed", "seed"])
	await seed("large", "life", 3000)
	await seed("large", "chats", 300)
	await seed("large", "reminders", 500)
	await seed("large", "boards", 300)
	await seed("large", "capture", 200)
	const large = await measureAll("large")

	// Budgets at the large size. Each bound sits well under the cost before the fix and well over the cost after it.
	// lifeView is not bounded here: with no naps built, every line is still a backlog line and the view reads them all.
	const BUDGET: Record<string, number> = {
		"human burst: signals (one burst)": 100,
		"agent post: chatTasks (one open task)": 100,
		// One row per chat's board, so the pass grows with the chats the owner keeps (300 seeded here), not with history.
		"daily initiative pass": 400,
		"capture pass: life nearest, earlier match found": 200,
		"capture pass: life nearest, no earlier match": 200,
	}
	const rows = ACTIONS.map((a) => `${a.name.padEnd(44)} small r${small[a.name]!.read} w${small[a.name]!.written}   large r${large[a.name]!.read} w${large[a.name]!.written}`)
	console.log(["action".padEnd(44), "small (read/written)", "large (read/written)"].join(" "), "\n" + rows.join("\n"))
	for (const [name, max] of Object.entries(BUDGET)) expect(large[name]!.read).toBeLessThanOrEqual(max)

}, 600_000)
