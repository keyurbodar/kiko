import { RoomSocket } from "./room-socket"
import { afterAll, beforeAll, expect, test } from "bun:test"
import type { RoomToClient } from "@kiko/protocol"
import { Miniflare } from "miniflare"
import { toMatch } from "../src/room/search"
import { bundleWorker } from "./bundle"

let mf: Miniflare
let origin: string

beforeAll(async () => {
	mf = new Miniflare({
		modules: true,
		script: await bundleWorker(new URL("./room-worker.ts", import.meta.url)),
		compatibilityDate: "2026-07-01",
		compatibilityFlags: ["nodejs_compat"],
		bindings: { SESSION_SECRET: "test-session-secret-at-least-32-chars" },
    durableObjects: { OWNER: { className: "OwnerProbe", useSQLite: true } },
	})
	origin = (await mf.ready).origin
}, 60_000)

afterAll(async () => {
	await mf?.dispose()
})

async function open(room: string) {
	const ws = new RoomSocket(`${origin.replace(/^http/, "ws")}/ws/${room}`)
	const frames: RoomToClient[] = []
	ws.onmessage = (e) => frames.push(JSON.parse(String(e.data)))
	await new Promise((resolve, reject) => {
		ws.onopen = resolve
		ws.onerror = reject
	})
	const take = async (match: (f: RoomToClient) => boolean) => {
		for (let i = 0; i < 2000; i++) {
			const at = frames.findIndex(match)
			if (at >= 0) return frames.splice(at, 1)[0]!
			await Bun.sleep(1)
		}
		throw new Error(`no frame. have ${JSON.stringify(frames)}`)
	}
	ws.send(JSON.stringify({ t: "hello", lastSeq: 0 }))
	await take((f) => f.t === "events")
	const send = (frame: unknown) => ws.send(JSON.stringify(frame))
	const search = async (query: string, extra = {}) => {
		send({ t: "search", query, ...extra })
		const f = await take((x) => x.t === "search" && x.query === query)
		return f as Extract<RoomToClient, { t: "search" }>
	}
	return { ws, send, take, search, frames }
}

test("toMatch quotes every word and makes the last one a prefix", () => {
	expect(toMatch('  say "hi" there ')).toBe('"say" "hi" "there"*')
	expect(toMatch('" "')).toBeNull()
	expect(toMatch("a OR b*")).toBe('"a" "OR" "b*"*')
})

test("the index follows insert, edit, and delete, and results page newest first", async () => {
	const c = await open("01JZ99WK4NT9WK4NT9WK4NT9WK")
	c.send({ t: "send", clientId: "a", text: "the quick brown fox" })
	const a = (await c.take((f) => f.t === "ack")) as { id: string; seq: number }
	c.send({ t: "send", clientId: "b", text: "a quick reply" })
	await c.take((f) => f.t === "ack")

	let page = await c.search("quick")
	expect(page.results.map((r) => r.seq)).toEqual([2, 1])
	expect(page.results[1]).toMatchObject({ id: a.id, from: { kind: "human" }, snippet: "the \u0002quick\u0003 brown fox" })
	expect(typeof page.results[1]!.at).toBe("number")

	page = await c.search("quick", { limit: 1 })
	expect(page).toMatchObject({ next: 2, results: [{ seq: 2 }] })
	page = await c.search("quick", { before: 2, limit: 1 })
	expect(page).toMatchObject({ next: null, results: [{ seq: 1 }] })

	c.send({ t: "edit", messageId: a.id, text: "the slow green turtle" })
	expect((await c.search("brown")).results).toEqual([])
	expect((await c.search("turtle")).results.map((r) => r.id)).toEqual([a.id])

	c.send({ t: "delete", messageId: a.id })
	expect((await c.search("turtle")).results).toEqual([])
	expect((await c.search("quick")).results.map((r) => r.seq)).toEqual([2])
	c.ws.close()
})

test("history returns the window around a seq, and pages at both ends", async () => {
	const c = await open("01JZ9AWK4NTAWK4NTAWK4NTAWK")
	const seqs: number[] = []
	for (let i = 0; i < 10; i++) {
		c.send({ t: "send", clientId: `h${i}`, text: `message ${i}` })
		seqs.push(((await c.take((f) => f.t === "ack")) as { seq: number }).seq)
	}
	const history = async (seq: number, before: number, after: number) => {
		c.send({ t: "history", seq, before, after })
		const f = (await c.take((x) => x.t === "history" && x.seq === seq && x.before === before && x.after === after)) as Extract<RoomToClient, { t: "history" }>
		return f.messages.map((m) => m.text)
	}
	expect(await history(seqs[5]!, 2, 2)).toEqual(["message 3", "message 4", "message 5", "message 6"])
	expect(await history(seqs[1]!, 5, 0)).toEqual(["message 0"])
	expect(await history(seqs[9]! + 1, 0, 5)).toEqual([])
	expect(await history(seqs[8]!, 0, 5)).toEqual(["message 8", "message 9"])
	const ids = await (async () => {
		c.send({ t: "search", query: "message" , limit: 50 })
		const f = (await c.take((x) => x.t === "search")) as Extract<RoomToClient, { t: "search" }>
		return f.results
	})()
	c.send({ t: "delete", messageId: ids.find((h) => h.seq === seqs[4])!.id })
	await c.take((f) => f.t === "events" && f.events.some((e) => e.t === "delete"))
	expect(await history(seqs[5]!, 2, 1)).toEqual(["message 2", "message 3", "message 5"])
	c.ws.close()
})

test("a prefix that matches every message in 10,000 still answers one page fast", async () => {
	const c = await open("01JZ9BWK4NTBWK4NTBWK4NTBWK")
	const total = 10_000
	for (let i = 0; i < total; i++) c.send({ t: "send", clientId: `f${i}`, text: `filler ${i} about nothing` })
	let done = false
	for (let i = 0; i < 3000 && !done; i++) {
		await Bun.sleep(100)
		done = c.frames.splice(0).some((f) => f.t === "ack" && f.clientId === `f${total - 1}`)
	}
	expect(done).toBe(true)
	let best = Infinity
	let page: Extract<RoomToClient, { t: "search" }> | undefined
	for (let i = 0; i < 5; i++) {
		const start = performance.now()
		page = await c.search("f")
		best = Math.min(best, performance.now() - start)
	}
	expect(page!.results).toHaveLength(20)
	expect(page!.results[0]!.seq).toBe(total)
	expect(page!.results[0]!.snippet).toContain("\u0002filler\u0003")
	console.log(`one-letter prefix over ${total} messages: ${best.toFixed(1)} ms`)
	expect(best).toBeLessThan(12)
	c.ws.close()
}, 300_000)
