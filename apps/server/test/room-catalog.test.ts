import { afterAll, beforeAll, expect, test } from "bun:test"
import type { RoomToClient } from "@kiko/protocol"
import { Miniflare } from "miniflare"
import { extractLinks } from "../src/room/catalog"
import { bundleWorker } from "./bundle"

// The links and media lists in the real RoomDO in workerd: newest first, paged by message,
// and a deleted message leaves both.
let mf: Miniflare
let origin: string

beforeAll(async () => {
	mf = new Miniflare({
		modules: true,
		script: await bundleWorker(new URL("./room-worker.ts", import.meta.url)),
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
	const catalog = async (kind: "links" | "media", extra = {}) => {
		send({ t: "catalog", kind, ...extra })
		return (await take((x) => x.t === "catalog" && x.kind === kind)) as Extract<RoomToClient, { t: "catalog" }>
	}
	return { ws, send, take, catalog }
}

test("extractLinks drops trailing punctuation and repeats", () => {
	expect(extractLinks("see https://www.example.com/a, and (https://b.dev/x). again https://www.example.com/a")).toEqual([
		{ url: "https://www.example.com/a", site: "example.com" },
		{ url: "https://b.dev/x", site: "b.dev" },
	])
	expect(extractLinks("no links, only http: words")).toEqual([])
})

test("links list newest first, page by message, and follow a delete", async () => {
	const c = await open("01JZ8Q4T6MCATALOG0000000001")
	c.send({ t: "send", clientId: "a", text: "first https://one.dev/a" })
	const a = (await c.take((f) => f.t === "ack")) as { id: string }
	c.send({ t: "send", clientId: "b", text: "plain words" })
	await c.take((f) => f.t === "ack")
	c.send({ t: "send", clientId: "c", text: "two https://two.dev/b and https://three.dev/c" })
	await c.take((f) => f.t === "ack")

	let page = await c.catalog("links")
	expect(page.items.map((i) => (i.kind === "link" ? i.url : ""))).toEqual(["https://two.dev/b", "https://three.dev/c", "https://one.dev/a"])
	expect(page.next).toBeNull()

	// One link asked for: the page still holds the whole message, and says there is more.
	page = await c.catalog("links", { limit: 1 })
	expect(page.items).toHaveLength(2)
	expect(page.next).toBe(3)
	page = await c.catalog("links", { before: 3, limit: 1 })
	expect(page.items.map((i) => i.seq)).toEqual([1])
	expect(page.next).toBeNull()

	c.send({ t: "delete", messageId: a.id })
	await c.take((f) => f.t === "events")
	expect((await c.catalog("links")).items).toHaveLength(2)
	c.ws.close()
})

test("media lists only pictures and clips that messages attached", async () => {
	const c = await open("01JZ8Q4T6MCATALOG0000000002")
	const png = { id: "f1", name: "a.png", size: 10, type: "image/png", width: 4, height: 3 }
	const pdf = { id: "f2", name: "a.pdf", size: 10, type: "application/pdf" }
	c.send({ t: "send", clientId: "a", text: "look", files: [png, pdf] })
	await c.take((f) => f.t === "ack")
	const page = await c.catalog("media")
	expect(page.items).toMatchObject([{ kind: "media", file: { id: "f1" }, seq: 1 }])
	expect((await c.catalog("links")).items).toEqual([])
	c.ws.close()
})
