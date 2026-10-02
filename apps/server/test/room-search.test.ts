import { afterAll, beforeAll, expect, test } from "bun:test"
import type { RoomToClient } from "@kiko/protocol"
import { Miniflare } from "miniflare"
import { toMatch } from "../src/room/search"

// Search in the real RoomDO in workerd: the index follows insert, edit, and delete.
let mf: Miniflare
let origin: string

beforeAll(async () => {
	const built = await Bun.build({
		entrypoints: [new URL("./room-worker.ts", import.meta.url).pathname],
		target: "browser",
		format: "esm",
		external: ["cloudflare:workers"],
	})
	if (!built.success) throw new Error(built.logs.join("\n"))
	mf = new Miniflare({
		modules: true,
		script: await built.outputs[0]!.text(),
		compatibilityDate: "2026-07-01",
		compatibilityFlags: ["nodejs_compat"],
		durableObjects: { ROOM: { className: "RoomDO", useSQLite: true } },
	})
	origin = (await mf.ready).origin
}, 60_000)

afterAll(async () => {
	await mf?.dispose()
})

async function open(room: string) {
	const ws = new WebSocket(`${origin.replace(/^http/, "ws")}/ws/${room}`)
	const frames: RoomToClient[] = []
	ws.onmessage = (e) => frames.push(JSON.parse(String(e.data)))
	await new Promise((resolve, reject) => {
		ws.onopen = resolve
		ws.onerror = reject
	})
	const take = async (match: (f: RoomToClient) => boolean) => {
		for (let i = 0; i < 100; i++) {
			const at = frames.findIndex(match)
			if (at >= 0) return frames.splice(at, 1)[0]!
			await Bun.sleep(20)
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
	return { ws, send, take, search }
}

test("toMatch quotes every word and makes the last one a prefix", () => {
	expect(toMatch('  say "hi" there ')).toBe('"say" "hi" "there"*')
	expect(toMatch('" "')).toBeNull()
	expect(toMatch("a OR b*")).toBe('"a" "OR" "b*"*')
})

test("the index follows insert, edit, and delete, and results page newest first", async () => {
	const c = await open("01JZ8Q4T6MSEARCH00000000001")
	c.send({ t: "send", clientId: "a", text: "the quick brown fox" })
	const a = (await c.take((f) => f.t === "ack")) as { id: string; seq: number }
	c.send({ t: "send", clientId: "b", text: "a quick reply" })
	await c.take((f) => f.t === "ack")

	let page = await c.search("quick")
	expect(page.results.map((r) => r.seq)).toEqual([2, 1])
	expect(page.results[1]).toMatchObject({ id: a.id, snippet: "the quick brown fox" })

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
