import { afterAll, beforeAll, expect, test } from "bun:test"
import type { RoomEvent, RoomToClient } from "@kiko/protocol"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

let mf: Miniflare
let origin: string

beforeAll(async () => {
	mf = new Miniflare({
		modules: true,
		script: await bundleWorker(new URL("./room-worker.ts", import.meta.url)),
		compatibilityDate: "2026-07-01",
		compatibilityFlags: ["nodejs_compat"],
		durableObjects: { ROOM: { className: "RoomProbe", useSQLite: true } },
	})
	origin = (await mf.ready).origin
}, 60_000)

afterAll(async () => {
	await mf?.dispose()
})

let n = 0
const fresh = () => `01JZ8Q4T6M${String(++n).padStart(16, "0")}`

class Client {
	frames: RoomToClient[] = []
	closed: number | null = null
	private waiters: (() => void)[] = []
	private constructor(readonly ws: WebSocket) {
		ws.onmessage = (e) => {
			this.frames.push(JSON.parse(String(e.data)))
			for (const w of this.waiters.splice(0)) w()
		}
		ws.onclose = (e) => {
			this.closed = e.code
			for (const w of this.waiters.splice(0)) w()
		}
	}
	static async open(room: string, lastSeq: number | null = 0): Promise<Client> {
		const ws = new WebSocket(`${origin.replace(/^http/, "ws")}/ws/${room}`)
		await new Promise((resolve, reject) => {
			ws.onopen = resolve
			ws.onerror = reject
		})
		const c = new Client(ws)
		if (lastSeq !== null) {
			c.send({ t: "hello", lastSeq })
			await c.next((f) => f.t === "events" || f.t === "reset")
		}
		return c
	}
	send(frame: unknown) {
		this.ws.send(typeof frame === "string" ? frame : JSON.stringify(frame))
	}
	async next(match: (f: RoomToClient) => boolean = () => true): Promise<RoomToClient> {
		const deadline = Date.now() + 2000
		for (;;) {
			const i = this.frames.findIndex(match)
			if (i >= 0) return this.frames.splice(i, 1)[0]!
			if (Date.now() > deadline) throw new Error(`no frame. have ${JSON.stringify(this.frames)}`)
			await new Promise<void>((r) => {
				this.waiters.push(r)
				setTimeout(r, 100)
			})
		}
	}
	async events(): Promise<RoomEvent[]> {
		const f = await this.next((x) => x.t === "events")
		return f.t === "events" ? [...f.events] : []
	}
	close() {
		this.ws.close()
	}
}

test("a send is acked, stored once, and broadcast to every ready socket", async () => {
	const room = fresh()
	const a = await Client.open(room)
	const b = await Client.open(room)
	a.send({ t: "send", clientId: "c1", text: "hi" })
	const ack = await a.next((f) => f.t === "ack")
	expect(ack).toMatchObject({ t: "ack", clientId: "c1", seq: 1 })
	const [event] = await b.events()
	expect(event).toMatchObject({ t: "message", clientId: "c1", seq: 1, text: "hi", from: { kind: "human" } })
	await a.events()

	a.send({ t: "send", clientId: "c1", text: "hi" })
	expect(await a.next((f) => f.t === "ack")).toEqual(ack)
	const c = await Client.open(room, null)
	c.send({ t: "hello", lastSeq: 0 })
	expect((await c.events()).length).toBe(1)
	expect(b.frames).toEqual([])
	for (const x of [a, b, c]) x.close()
})

test("a long chat keeps a bounded event log, and replay still has every event of its window", async () => {
	const room = fresh()
	const a = await Client.open(room)
	const sendAll = async (from: number, to: number) => {
		for (let i = from; i < to; i++) a.send({ t: "send", clientId: `m${i}`, text: `message ${i}` })
		const deadline = Date.now() + 30_000
		while (!a.frames.some((f) => f.t === "ack" && f.clientId === `m${to - 1}`) && Date.now() < deadline) await Bun.sleep(20)
		a.frames.length = 0
	}
	const rows = async () => (await (await fetch(`${origin}/rows/${room}`)).json()) as number
	await sendAll(0, 1_100)
	const before = await rows()
	await sendAll(1_100, 1_300)
	expect((await rows()) - before).toBeLessThanOrEqual(3 * 200 + 50)
	const late = await Client.open(room, null)
	late.send({ t: "hello", lastSeq: 900 })
	const replay = await late.events()
	expect(replay.map((e) => e.seq)).toEqual(Array.from({ length: 400 }, (_, i) => 901 + i))
	late.close()
	a.close()
}, 60_000)

test("edit, react, delete, and read are events, and hello replays them in order", async () => {
	const room = fresh()
	const a = await Client.open(room)
	a.send({ t: "send", clientId: "x", text: "one" })
	const { id } = (await a.next((f) => f.t === "ack")) as { id: string }
	a.send({ t: "edit", messageId: id, text: "uno" })
	a.send({ t: "react", messageId: id, emoji: "👍" })
	a.send({ t: "react", messageId: id, emoji: "👍" }) // no change, no event
	a.send({ t: "react", messageId: id, emoji: null })
	a.send({ t: "read", seq: 99 })
	a.send({ t: "delete", messageId: id })
	a.send({ t: "delete", messageId: id }) // already gone, no event
	a.send({ t: "edit", messageId: id, text: "late" }) // gone, no event
	a.send({ t: "send", clientId: "y", text: "two" })
	await a.next((f) => f.t === "ack" && f.clientId === "y")
	a.close()

	const b = await Client.open(room, null)
	b.send({ t: "hello", lastSeq: 1 })
	const events = await b.events()
	expect(events.map((e) => [e.seq, e.t])).toEqual([
		[2, "edit"],
		[3, "react"],
		[4, "react"],
		[5, "read"],
		[6, "delete"],
		[7, "message"],
	])
	expect(events[1]).toMatchObject({ messageId: id, by: { kind: "human" }, emoji: "👍" })
	expect(events[2]).toMatchObject({ emoji: null })
	expect(events[3]).toMatchObject({ upTo: 4 })

	b.send({ t: "hello", lastSeq: 7 })
	expect(await b.events()).toEqual([])
	b.close()
})

test("a client too far behind, or ahead of the log, gets a reset snapshot", async () => {
	const room = fresh()
	const a = await Client.open(room)
	for (let i = 0; i < 502; i++) a.send({ t: "send", clientId: `m${i}`, text: `m${i}` })
	await a.next((f) => f.t === "ack" && f.clientId === "m501")
	a.send({ t: "react", messageId: ((await a.next((f) => f.t === "ack")) as { id: string }).id, emoji: "🔥" })
	a.send({ t: "read", seq: 500 })
	a.send({ t: "hello", lastSeq: 1 })
	const reset = await a.next((f) => f.t === "reset")
	if (reset.t !== "reset") throw new Error("unreachable")
	expect(reset.snapshot.seq).toBe(504)
	expect(reset.snapshot.readSeq).toBe(500)
	expect(reset.snapshot.messages.length).toBe(200)
	expect(reset.snapshot.messages.at(-1)?.text).toBe("m501")
	a.frames = [] // the broadcasts of the sends above, all before the reset

	a.send({ t: "hello", lastSeq: 3 }) // 501 behind
	expect((await a.next((f) => f.t === "reset" || f.t === "events")).t).toBe("reset")
	a.send({ t: "hello", lastSeq: 4 }) // exactly 500 behind
	expect((await a.events()).length).toBe(500)
	a.send({ t: "hello", lastSeq: 9999 }) // a client from a wiped room
	expect((await a.next((f) => f.t === "reset" || f.t === "events")).t).toBe("reset")
	a.close()
})

test("a reaction on a message shows in the snapshot", async () => {
	const room = fresh()
	const a = await Client.open(room)
	a.send({ t: "send", clientId: "r", text: "x" })
	const { id } = (await a.next((f) => f.t === "ack")) as { id: string }
	a.send({ t: "react", messageId: id, emoji: "🔥" })
	await a.events()
	await a.events()
	a.send({ t: "hello", lastSeq: 50 })
	const reset = await a.next((f) => f.t === "reset")
	expect(reset.t === "reset" && reset.snapshot.messages[0]?.reactions).toEqual([{ by: { kind: "human" }, emoji: "🔥" }])
	a.close()
})

test("typing is broadcast and never stored", async () => {
	const room = fresh()
	const a = await Client.open(room)
	await fetch(`${origin}/typing/${room}/ada/1`)
	expect(await a.next((f) => f.t === "typing")).toEqual({ t: "typing", who: ["ada"] })
	await fetch(`${origin}/typing/${room}/ada/0`)
	expect(await a.next((f) => f.t === "typing")).toEqual({ t: "typing", who: [] })
	a.send({ t: "typing" })
	a.send({ t: "hello", lastSeq: 0 })
	expect(await a.events()).toEqual([])
	a.close()
})

test("a socket gets no broadcast before hello", async () => {
	const room = fresh()
	const quiet = await Client.open(room, null)
	const a = await Client.open(room)
	a.send({ t: "send", clientId: "q", text: "x" })
	await a.events()
	await Bun.sleep(100)
	expect(quiet.frames).toEqual([])
	quiet.close()
	a.close()
})

test("an older client's retired catalog frame is ignored and the socket stays open", async () => {
	const room = fresh()
	const a = await Client.open(room)
	a.send({ t: "catalog", kind: "media" })
	a.send({ t: "send", clientId: "after", text: "still here" })
	const ack = await a.next((f) => f.t === "ack")
	expect(ack).toMatchObject({ clientId: "after" })
	expect(a.closed).toBeNull()
	expect(a.frames.some((f) => (f as { t: string }).t === "catalog")).toBe(false)
	a.close()
})

test.each([
	["not json", "{"],
	["an unknown frame", { t: "nope" }],
	["an empty send", { t: "send", clientId: "e", text: "  " }],
	["a send past the frame", { t: "send", clientId: "l", text: "a".repeat(600_000) }],
	["a negative lastSeq", { t: "hello", lastSeq: -1 }],
])("%s closes the socket and stores nothing", async (_, frame) => {
	const room = fresh()
	const a = await Client.open(room)
	a.send(frame)
	const deadline = Date.now() + 2000
	while (a.closed === null && Date.now() < deadline) await Bun.sleep(20)
	expect(a.closed).toBe(1008)
	const b = await Client.open(room, null)
	b.send({ t: "hello", lastSeq: 0 })
	expect(await b.events()).toEqual([])
	b.close()
})
