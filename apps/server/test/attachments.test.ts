import { afterAll, beforeAll, expect, test } from "bun:test"
import type { FileRef, RoomEvent, RoomToClient } from "@kiko/protocol"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

let mf: Miniflare
let origin: string

beforeAll(async () => {
	mf = new Miniflare({
		modules: true,
		script: await bundleWorker(new URL("./files-worker.ts", import.meta.url)),
		compatibilityDate: "2026-07-01",
		compatibilityFlags: ["nodejs_compat"],
    bindings: { SESSION_SECRET: "test-session-secret-at-least-32-chars" },
		durableObjects: { ROOM: { className: "RoomDO", useSQLite: true }, USER: { className: "UserDO", useSQLite: true } },
		r2Buckets: ["FILES"],
	})
	origin = (await mf.ready).origin
}, 60_000)

afterAll(async () => {
	await mf?.dispose()
})

let n = 0
const fresh = () => `01JZ8Q4T6N${String(++n).padStart(16, "0")}`
const as = { "x-test-user": "alice" }
const MiB = 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function upload(room: string, id: string, body: string | Uint8Array, init: { name?: string; size?: number; type?: string } = {}) {
	const size = init.size ?? (typeof body === "string" ? new TextEncoder().encode(body).length : body.length)
	const q = new URLSearchParams({ name: init.name ?? "notes.txt", size: String(size) })
	return fetch(`${origin}/api/files/${room}/pending/${id}?${q}`, {
		method: "PUT",
		headers: { ...as, "content-type": init.type ?? "text/plain" },
		body,
	})
}

const keys = async (room: string) => ((await (await fetch(`${origin}/keys`)).json()) as string[]).filter((k) => k.includes(room))

class Client {
	frames: RoomToClient[] = []
	private waiters: (() => void)[] = []
	private constructor(readonly ws: WebSocket) {
		ws.onmessage = (e) => {
			this.frames.push(JSON.parse(String(e.data)))
			for (const w of this.waiters.splice(0)) w()
		}
	}
	static async open(room: string): Promise<Client> {
		const ws = new WebSocket(`${origin.replace(/^http/, "ws")}/ws/alice/${room}`)
		await new Promise((resolve, reject) => {
			ws.onopen = resolve
			ws.onerror = reject
		})
		const c = new Client(ws)
		c.send({ t: "hello", lastSeq: 0 })
		await c.next((f) => f.t === "events" || f.t === "reset")
		return c
	}
	send(frame: unknown) {
		this.ws.send(JSON.stringify(frame))
	}
	async next(match: (f: RoomToClient) => boolean, ms = 3000): Promise<RoomToClient> {
		const deadline = Date.now() + ms
		for (;;) {
			const i = this.frames.findIndex(match)
			if (i >= 0) return this.frames.splice(i, 1)[0]!
			if (Date.now() > deadline) throw new Error(`no frame. have ${JSON.stringify(this.frames)}`)
			await new Promise<void>((r) => {
				this.waiters.push(r)
				setTimeout(r, 50)
			})
		}
	}
	async replay(): Promise<RoomEvent[]> {
		this.send({ t: "hello", lastSeq: 0 })
		const f = await this.next((x) => x.t === "events")
		return f.t === "events" ? [...f.events] : []
	}
	close() {
		this.ws.close()
	}
}

const sendFrame = (clientId: string, attachments: { pendingId: string; name: string; type: string; size: number }[], text = "") => ({ t: "send", clientId, text, attachments })

test("a pending upload is not the chat's until a send claims it, then it is a file the message carries", async () => {
	const room = fresh()
	const id = crypto.randomUUID()
	const put = await upload(room, id, "hello there")
	expect(put.status).toBe(204)
	expect(await keys(room)).toEqual([`u/alice/r/${room}/${id}`])
	const c = await Client.open(room)
	expect((await c.replay()).some((e) => e.t === "file")).toBe(false)

	c.send(sendFrame("c1", [{ pendingId: id, name: "notes.txt", type: "text/plain", size: 11 }], `see [notes.txt](attachment:${id}) and [gone.txt](attachment:other)`))
	const ack = await c.next((f) => f.t === "ack")
	const events = await c.next((f) => f.t === "events")
	const all = events.t === "events" ? events.events : []
	const file = all.find((e) => e.t === "file")
	const message = all.find((e) => e.t === "message")
	expect(file && file.t === "file" && file.file).toMatchObject({ id, size: 11, type: "text/plain" })
	expect(file && file.t === "file" && file.file.name).toMatch(/^attachments\/[0-9a-z]+-notes\.txt$/)
	expect(message && message.t === "message" && message.files).toEqual([(file as { file: FileRef }).file])
	// The chip the human placed links to where the file was stored. A chip with no upload is its name.
	expect(message?.t === "message" && message.text).toBe(`see [notes.txt](/${(file as { file: FileRef }).file.name}) and gone.txt`)
	expect(ack.t === "ack" && message?.t === "message" && ack.id).toBe(message?.t === "message" ? message.id : "")

	const got = await fetch(`${origin}/api/files/${room}/${id}`, { headers: as })
	expect(await got.text()).toBe("hello there")
	const del = await fetch(`${origin}/api/files/${room}/pending/${id}`, { method: "DELETE", headers: as })
	expect(del.status).toBe(404)
	await del.body?.cancel()
	expect(await keys(room)).toEqual([`u/alice/r/${room}/${id}`])
	c.close()
})

test("a send names files only by pending upload: a files field from an old client carries nothing", async () => {
	const room = fresh()
	const c = await Client.open(room)
	c.send({ t: "send", clientId: "old", text: "hi", files: [{ id: crypto.randomUUID(), name: "attachments/x-a.txt", size: 1, type: "text/plain" }] })
	const answer = await c.next((f) => f.t === "ack" || f.t === "send_refused")
	expect(answer.t).toBe("ack")
	const events = await c.next((f) => f.t === "events")
	const message = events.t === "events" ? events.events.find((e) => e.t === "message") : undefined
	expect(message?.t === "message" && message.files).toBeFalsy()
	c.close()
})

test("a send resent with the same client id claims once and gets the first ack", async () => {
	const room = fresh()
	const id = crypto.randomUUID()
	expect((await upload(room, id, "once")).status).toBe(204)
	const c = await Client.open(room)
	const frame = sendFrame("again", [{ pendingId: id, name: "notes.txt", type: "text/plain", size: 4 }])
	c.send(frame)
	const first = await c.next((f) => f.t === "ack")
	c.send(frame)
	const second = await c.next((f) => f.t === "ack" || f.t === "send_refused")
	expect(second).toEqual(first)
	const replay = await c.replay()
	expect(replay.filter((e) => e.t === "message").length).toBe(1)
	expect(replay.filter((e) => e.t === "file").length).toBe(1)
	c.close()
})

test("a claim of an upload that is gone, a wrong size, or a repeated id stores nothing and says why", async () => {
	const room = fresh()
	const id = crypto.randomUUID()
	expect((await upload(room, id, "abc")).status).toBe(204)
	const c = await Client.open(room)
	const refusal = async (clientId: string, attachments: Parameters<typeof sendFrame>[1]) => {
		c.send(sendFrame(clientId, attachments, "hi"))
		const f = await c.next((x) => x.t === "send_refused" || x.t === "ack")
		return f.t === "send_refused" ? f.reason : `acked ${JSON.stringify(f)}`
	}
	const missing = crypto.randomUUID()
	expect(await refusal("m1", [{ pendingId: missing, name: "gone.pdf", type: "application/pdf", size: 3 }])).toBe(
		"Attachment 'gone.pdf' cannot be sent: attachment not found (removed or expired).",
	)
	expect(await refusal("m2", [{ pendingId: id, name: "notes.txt", type: "text/plain", size: 4 }])).toBe(
		"Attachment 'notes.txt' cannot be sent: stored size does not match.",
	)
	const a = { pendingId: id, name: "notes.txt", type: "text/plain", size: 3 }
	expect(await refusal("m3", [a, a])).toBe("Duplicate attachment ids are not allowed.")
	const many = Array.from({ length: 101 }, () => ({ ...a, pendingId: crypto.randomUUID() }))
	expect(await refusal("m4", many)).toBe("You can attach up to 100 files per message.")
	expect(await refusal("m5", [a, { ...a, pendingId: missing }])).toContain("attachment not found")
	const replay = await c.replay()
	expect(replay.some((e) => e.t === "message" || e.t === "file")).toBe(false)
	c.send(sendFrame("m6", [a]))
	expect((await c.next((x) => x.t === "ack" || x.t === "send_refused")).t).toBe("ack")
	c.close()
})

test("an upload is refused when its length lies, it is empty, or it is over its type's limit", async () => {
	const room = fresh()
	const lie = await upload(room, crypto.randomUUID(), "hello", { size: 10 })
	expect(lie.status).toBe(400)
	expect(((await lie.json()) as { error: string }).error).toBe("Content-Length must match the upload size.")
	const empty = await upload(room, crypto.randomUUID(), "", { name: "blank.txt" })
	expect(((await empty.json()) as { error: string }).error).toBe("'blank.txt' is empty or could not be read.")
	const picture = await upload(room, crypto.randomUUID(), new Uint8Array(10 * MiB + 1), { name: "big.png", type: "image/png" })
	expect(picture.status).toBe(413)
	expect(((await picture.json()) as { error: string }).error).toBe("'big.png' exceeds the 10 MB attachment limit.")
	expect((await upload(room, crypto.randomUUID(), new Uint8Array(10 * MiB + 1), { name: "big.bin", type: "application/octet-stream" })).status).toBe(204)
	expect((await keys(room)).length).toBe(1)
})

test("delete removes a pending upload and its bytes, once", async () => {
	const room = fresh()
	const id = crypto.randomUUID()
	expect((await upload(room, id, "bye")).status).toBe(204)
	const del = () => fetch(`${origin}/api/files/${room}/pending/${id}`, { method: "DELETE", headers: as })
	expect((await del()).status).toBe(204)
	expect(await keys(room)).toEqual([])
	const again = await del()
	expect(again.status).toBe(404)
	await again.body?.cancel()
	const c = await Client.open(room)
	c.send(sendFrame("d1", [{ pendingId: id, name: "notes.txt", type: "text/plain", size: 3 }]))
	expect((await c.next((x) => x.t === "send_refused" || x.t === "ack")).t).toBe("send_refused")
	c.close()
})

test("an upload may not take the id of a sent file", async () => {
	const room = fresh()
	const id = crypto.randomUUID()
	expect((await upload(room, id, "first")).status).toBe(204)
	const c = await Client.open(room)
	c.send(sendFrame("s1", [{ pendingId: id, name: "notes.txt", type: "text/plain", size: 5 }]))
	await c.next((x) => x.t === "ack")
	const over = await upload(room, id, "other")
	expect(over.status).toBe(409)
	await over.body?.cancel()
	expect(await (await fetch(`${origin}/api/files/${room}/${id}`, { headers: as })).text()).toBe("first")
	c.close()
})

test("the sweep deletes pending uploads older than a day and leaves sent files", async () => {
	const room = fresh()
	const sent = crypto.randomUUID()
	const stale = crypto.randomUUID()
	expect((await upload(room, sent, "keep")).status).toBe(204)
	expect((await upload(room, stale, "drop")).status).toBe(204)
	const c = await Client.open(room)
	c.send(sendFrame("w1", [{ pendingId: sent, name: "notes.txt", type: "text/plain", size: 4 }]))
	await c.next((x) => x.t === "ack")
	const sweep = (at: number) => fetch(`${origin}/sweep/alice/${room}?at=${at}`).then((r) => r.json())
	expect(await sweep(Date.now() + 3_600_000)).toBe(0)
	expect(await sweep(Date.now() + 25 * 3_600_000)).toBe(1)
	expect(await keys(room)).toEqual([`u/alice/r/${room}/${sent}`])
	expect(await sweep(Date.now() + 25 * 3_600_000)).toBe(0)
	c.close()
})

test("a human message past the bubble limit shows its first 16,000 characters and keeps the whole text as a file", async () => {
	const room = fresh()
	const c = await Client.open(room)
	const text = "0123456789".repeat(4_000)
	c.send({ t: "send", clientId: "long1", text })
	const ack = await c.next((f) => f.t === "ack")
	const events = await c.next((f) => f.t === "events")
	const all = events.t === "events" ? events.events : []
	const message = all.find((e) => e.t === "message")
	const file = all.find((e) => e.t === "file")
	expect(ack.t === "ack" && ack.id).toBe(message?.t === "message" ? message.id : "")
	expect(message?.t === "message" && message.text.length).toBe(16_000)
	const ref = file?.t === "file" ? file.file : null
	expect(ref).toMatchObject({ size: 40_000, type: "text/plain" })
	expect(ref?.id).toMatch(UUID)
	expect(ref?.name).toMatch(/^attachments\/[0-9a-z]+-message\.txt$/)
	expect(message?.t === "message" && message.files).toEqual(ref ? [ref] : [])
	const got = await fetch(`${origin}/api/files/${room}/${ref?.id}`, { headers: as })
	expect(await got.text()).toBe(text)
	c.close()
})

test("a long human message resent with its client id stores one message and one file", async () => {
	const room = fresh()
	const c = await Client.open(room)
	const frame = { t: "send", clientId: "long2", text: "x".repeat(20_000) }
	c.send(frame)
	const first = await c.next((f) => f.t === "ack")
	c.send(frame)
	expect(await c.next((f) => f.t === "ack" || f.t === "send_refused")).toEqual(first)
	const replay = await c.replay()
	expect(replay.filter((e) => e.t === "message").length).toBe(1)
	expect(replay.filter((e) => e.t === "file").length).toBe(1)
	const [sent] = replay.filter((e) => e.t === "file")
	expect(await keys(room)).toEqual([`u/alice/r/${room}/${sent?.t === "file" ? sent.file.id : ""}`])
	c.close()
})

test("a long message refused by its attachments leaves no whole-text object behind", async () => {
	const room = fresh()
	const c = await Client.open(room)
	const before = await keys(room)
	c.send({ t: "send", clientId: "long3", text: "x".repeat(20_000), attachments: [{ pendingId: crypto.randomUUID(), name: "gone.txt", type: "text/plain", size: 3 }] })
	expect((await c.next((f) => f.t === "send_refused")).t).toBe("send_refused")
	expect(await keys(room)).toEqual(before)
	c.close()
})

test("two sends from one socket keep their order when the first one waits on R2", async () => {
	const room = fresh()
	const c = await Client.open(room)
	c.send({ t: "send", clientId: "order-long", text: "x".repeat(40_000) })
	c.send({ t: "send", clientId: "order-short", text: "after" })
	const long = await c.next((f) => f.t === "ack" && f.clientId === "order-long")
	const short = await c.next((f) => f.t === "ack" && f.clientId === "order-short")
	if (long.t !== "ack" || short.t !== "ack") throw new Error("no ack")
	expect(long.seq).toBeLessThan(short.seq)
	c.close()
})
