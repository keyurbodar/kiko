import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

// Rows written by the paths that run on every connection, switch and view. Free allows 100,000 rows written a
// day for the whole account, so a path that rewrites an unchanged value spends it for nothing. A write is a
// row a statement wrote, a key-value put or delete, or an alarm set or cleared.

let mf: Miniflare
let origin: string

beforeAll(async () => {
	mf = new Miniflare({
		modules: true,
		script: await bundleWorker(new URL("./do-hygiene-worker.ts", import.meta.url)),
		compatibilityDate: "2026-07-01",
		compatibilityFlags: ["nodejs_compat"],
    bindings: { SESSION_SECRET: "test-session-secret-at-least-32-chars" },
		durableObjects: { OWNER: { className: "MeteredOwner", useSQLite: true } },

	})
	origin = (await mf.ready).origin
}, 60_000)

afterAll(async () => {
	await mf?.dispose()
})

type Cost = { read: number; written: number }

const counts = async (path: string): Promise<Cost> => (await (await fetch(`${origin}${path}/counts`)).json()) as Cost

async function call(room: string, method: string, ...args: unknown[]): Promise<unknown> {
	const res = await fetch(`${origin}/room/${room}/call/${method}`, { method: "POST", body: JSON.stringify(args) })
	if (!res.ok) throw new Error(`${method}: ${res.status} ${await res.text()}`)
	return res.json()
}

// What `act` read and wrote, from the object's counters. The wait lets work the action starts in the background finish.
async function measure(path: string, act: () => Promise<unknown>): Promise<Cost> {
	await Bun.sleep(200)
	const before = await counts(path)
	await act()
	await Bun.sleep(300)
	const after = await counts(path)
	return { read: after.read - before.read, written: after.written - before.written }
}

const open = async (url: string) => {
	const ws = new WebSocket(url)
	const frames: string[] = []
	ws.onmessage = (e) => frames.push(String(e.data))
	await new Promise((resolve, reject) => {
		ws.onopen = resolve
		ws.onerror = reject
	})
	return { ws, frames, send: (frame) => ws.send(typeof frame === "string" ? frame : JSON.stringify(frame)) }
}

const until = async (done: () => boolean) => {
	for (let t = 0; t < 10_000 && !done(); t += 5) await Bun.sleep(5)
	expect(done()).toBe(true)
}

const wsUrl = (path: string) => `${origin.replace(/^http/, "ws")}${path}`

const ROOM_A = "01JZ9HYG0A000000000000000A"
const ROOM_B = "01JZ9HYG0B000000000000000B"
const ROOM_VIEWS = "01JZ9HYG0V000000000000000V"

for (const [name, path] of [
	["user", "/user"],
	["room", `/room/${ROOM_A}`],
] as const) {
	test(`a ping to the ${name} object is answered without waking it or touching storage`, async () => {
		const sock = await open(wsUrl(`${path}/ws`))
		sock.send({ t: "hello", lastSeq: 0 })
		await until(() => sock.frames.length > 0)
		sock.frames.length = 0
		const cost = await measure(path, async () => {
			for (let i = 0; i < 5; i++) sock.send("ping")
			await until(() => sock.frames.filter((f) => f === "pong").length === 5)
		})
		sock.ws.close()
		expect(cost).toEqual({ read: 0, written: 0 })
	})

	test(`a ${name} alarm with nothing due writes nothing`, async () => {
		await fetch(`${origin}${path}/wake`)
		const cost = await measure(path, () => fetch(`${origin}${path}/wake`))
		console.log(`ROW ${name} idle alarm read=${cost.read} written=${cost.written}`)
		expect(cost.written).toBe(0)
	})
}

test("opening the chat the owner already has open writes nothing", async () => {
	const sock = await open(wsUrl("/user/ws"))
	sock.send({ t: "hello", lastSeq: 0 })
	await until(() => sock.frames.length > 0)
	const first = await measure("/user", async () => sock.send({ t: "open", roomId: ROOM_A }))
	const again = await measure("/user", async () => sock.send({ t: "open", roomId: ROOM_A }))
	const other = await measure("/user", async () => sock.send({ t: "open", roomId: ROOM_B }))
	sock.ws.close()
	console.log(`ROW user open chat: first written=${first.written}, same again written=${again.written}, other written=${other.written}`)
	expect(first.written).toBeGreaterThan(0)
	expect(again.written).toBe(0)
	expect(other.written).toBeGreaterThan(0)
})

test("an agent's views of the chat do not rewrite the quiet timer each time", async () => {
	const first = await measure(`/room/${ROOM_VIEWS}`, () => call(ROOM_VIEWS, "memoryView", []))
	const second = await measure(`/room/${ROOM_VIEWS}`, () => call(ROOM_VIEWS, "memoryView", []))
	const since = await measure(`/room/${ROOM_VIEWS}`, () => call(ROOM_VIEWS, "memorySince", "ada", 0, []))
	console.log(`ROW room memory view: first written=${first.written}, second written=${second.written}, since written=${since.written}`)
	expect(first.written).toBeGreaterThan(0)
	expect(second.written).toBe(0)
	expect(since.written).toBe(0)
})
