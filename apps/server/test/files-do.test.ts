import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { bundleWorker } from "./bundle"

// No r2Buckets: the install has no R2 binding, so every byte goes through OwnerDO’s local blob store.
let mf: Miniflare
let origin: string

beforeAll(async () => {
	mf = new Miniflare({
		modules: true,
		script: await bundleWorker(new URL("./files-worker.ts", import.meta.url)),
		compatibilityDate: "2026-07-01",
		compatibilityFlags: ["nodejs_compat"],
		bindings: { SESSION_SECRET: "test-session-secret-at-least-32-chars" },
		durableObjects: { OWNER: { className: "OwnerDO", useSQLite: true } },
	})
	origin = (await mf.ready).origin
}, 60_000)

afterAll(async () => {
	await mf?.dispose()
})

let n = 0
const fresh = () => `01JZ8Q4T6M${String(++n).padStart(16, "0")}`
const alice = { "x-test-user": "alice" }
const bytesOf = (size: number) => Uint8Array.from({ length: size }, (_, i) => (i * 31 + (i >> 8)) & 255)
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])

async function put(room: string, path: string, body: Uint8Array, expect = "none") {
	const res = await fetch(`${origin}/api/files/${room}?path=${encodeURIComponent(path)}`, {
		method: "PUT",
		headers: { ...alice, "content-type": "application/octet-stream", "x-kiko-if-sha256": expect },
		body,
	})
	if (res.status >= 500) throw new Error(await res.text())
	return { status: res.status, body: (await res.json()) as { file: { id: string; size: number } } }
}

const get = (room: string, id: string, headers: Record<string, string> = {}) => fetch(`${origin}/api/files/${room}/${id}`, { headers: { ...alice, ...headers } })

test("a file over several chunks uploads and downloads byte for byte", async () => {
	const room = fresh()
	const data = bytesOf(2.5 * 1024 * 1024 + 7)
	const { status, body } = await put(room, "big.bin", data)
	expect(status).toBe(200)
	expect(body.file.size).toBe(data.length)
	const res = await get(room, body.file.id)
	expect(res.status).toBe(200)
	expect(same(new Uint8Array(await res.arrayBuffer()), data)).toBe(true)
})

test("a range that crosses a chunk boundary returns exactly those bytes", async () => {
	const room = fresh()
	const data = bytesOf(3 * 1024 * 1024)
	const { body } = await put(room, "r.bin", data)
	const start = 1024 * 1024 - 10
	const res = await get(room, body.file.id, { range: `bytes=${start}-${start + 2_000_000 - 1}` })
	expect(res.status).toBe(206)
	expect(res.headers.get("content-range")).toBe(`bytes ${start}-${start + 2_000_000 - 1}/${data.length}`)
	expect(same(new Uint8Array(await res.arrayBuffer()), data.slice(start, start + 2_000_000))).toBe(true)
	const tail = await get(room, body.file.id, { range: "bytes=-5" })
	expect(same(new Uint8Array(await tail.arrayBuffer()), data.slice(-5))).toBe(true)
})

test("an empty file and an exact-chunk file both round-trip", async () => {
	const room = fresh()
	for (const size of [0, 1024 * 1024]) {
		const data = bytesOf(size)
		const { body } = await put(room, `s${size}.bin`, data)
		const res = await get(room, body.file.id)
		expect(same(new Uint8Array(await res.arrayBuffer()), data)).toBe(true)
	}
})

test("new bytes at a path delete the old file's bytes", async () => {
	const room = fresh()
	const first = await put(room, "a.txt", bytesOf(100))
	const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytesOf(100))), (b) => b.toString(16).padStart(2, "0")).join("")
	const second = await put(room, "a.txt", bytesOf(200), sha)
	expect(second.status).toBe(200)
	expect((await get(room, first.body.file.id)).status).toBe(404)
	expect((await get(room, second.body.file.id)).status).toBe(200)
})

test("a pending attachment upload stores and serves from the built-in store", async () => {
	const room = fresh()
	const id = crypto.randomUUID()
	const data = bytesOf(1_500_000)
	const res = await fetch(`${origin}/api/files/${room}/pending/${id}?name=a.bin&size=${data.length}`, {
		method: "PUT",
		headers: { ...alice, "content-type": "application/octet-stream" },
		body: data,
	})
	expect(res.status).toBe(204)
	expect(same(new Uint8Array(await (await get(room, id)).arrayBuffer()), data)).toBe(true)
	expect((await fetch(`${origin}/api/files/${room}/pending/${id}`, { method: "DELETE", headers: alice })).status).toBe(204)
	expect((await get(room, id)).status).toBe(404)
})

test("a multipart upload joins its parts in order", async () => {
	const room = fresh()
	const parts = [bytesOf(1_500_000), bytesOf(1_048_576).map((v) => v ^ 5), bytesOf(10)]
	const total = parts.reduce((a, p) => a + p.length, 0)
	const created = await fetch(`${origin}/api/files/${room}/uploads`, {
		method: "POST",
		headers: { ...alice, "content-type": "application/json" },
		body: JSON.stringify({ path: "m.bin", size: total, expect: "none", type: "application/octet-stream" }),
	})
	const { fileId, uploadId } = (await created.json()) as { fileId: string; uploadId: string }
	const etags: { partNumber: number; etag: string }[] = []
	for (const [i, part] of parts.entries()) {
		const res = await fetch(`${origin}/api/files/${room}/uploads/${fileId}/${i + 1}?uploadId=${uploadId}`, { method: "PUT", headers: alice, body: part })
		etags.push((await res.json()) as { partNumber: number; etag: string })
	}
	const done = await fetch(`${origin}/api/files/${room}/uploads/${fileId}?uploadId=${uploadId}`, {
		method: "POST",
		headers: { ...alice, "content-type": "application/json" },
		body: JSON.stringify({ parts: etags }),
	})
	const doneText = await done.text()
	expect(`${done.status} ${doneText}`).toStartWith("200 ")
	const expected = new Uint8Array(total)
	let at = 0
	for (const p of parts) {
		expected.set(p, at)
		at += p.length
	}
	expect(same(new Uint8Array(await (await get(room, fileId)).arrayBuffer()), expected)).toBe(true)
})

test("a file past the built-in store's cap is refused before any byte is stored", async () => {
	const room = fresh()
	const res = await fetch(`${origin}/api/files/${room}/uploads`, {
		method: "POST",
		headers: { ...alice, "content-type": "application/json" },
		body: JSON.stringify({ path: "huge.bin", size: 200 * 1024 * 1024, expect: "none" }),
	})
	expect(res.status).toBe(413)
})

test("one user cannot read another user's file", async () => {
	const room = fresh()
	const { body } = await put(room, "mine.txt", bytesOf(10))
	expect((await fetch(`${origin}/api/files/${room}/${body.file.id}`, { headers: { "x-test-user": "bob" } })).status).toBe(404)
})

test("an agent's write and read use the built-in store", async () => {
	const room = fresh()
	const out = (await (await fetch(`${origin}/agent/alice/${room}`)).json()) as { wrote: boolean; read: string | null }
	expect(out).toEqual({ wrote: true, read: "from the agent" })
})
