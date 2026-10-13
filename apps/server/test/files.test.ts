import { afterAll, beforeAll, expect, test } from "bun:test"
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
		durableObjects: { ROOM: { className: "RoomDO", useSQLite: true }, USER: { className: "UserDO", useSQLite: true } },
		r2Buckets: ["FILES"],
	})
	origin = (await mf.ready).origin
}, 60_000)

afterAll(async () => {
	await mf?.dispose()
})

let n = 0
const fresh = () => `01JZ8Q4T6M${String(++n).padStart(16, "0")}`
const as = (user: string) => ({ "x-test-user": user })

type FileBody = { file: { id: string; name: string; size: number; type: string } }

async function put(room: string, path: string, body: string, expect = "none") {
	const res = await fetch(`${origin}/api/files/${room}?path=${encodeURIComponent(path)}`, {
		method: "PUT",
		headers: { ...as("alice"), "content-type": "text/plain", "x-kiko-if-sha256": expect },
		body,
	})
	return { status: res.status, body: (await res.json()) as FileBody }
}

const sha = async (text: string) =>
	Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("")

const keys = async (room: string) =>
	((await (await fetch(`${origin}/keys`)).json()) as string[]).filter((k) => k.includes(room))

test("the same bytes at the same path store one object", async () => {
	const room = fresh()
	const first = await put(room, "notes/a.txt", "hello")
	const second = await put(room, "notes/a.txt", "hello", await sha("hello"))
	expect(first.status).toBe(200)
	expect(second.body.file).toEqual(first.body.file)
	expect(await keys(room)).toEqual([`u/alice/r/${room}/${first.body.file.id}`])
})

test("new bytes at a path replace the row and delete the old object", async () => {
	const room = fresh()
	const first = await put(room, "a.txt", "one")
	const second = await put(room, "a.txt", "two!", await sha("one"))
	expect(second.body.file.id).not.toBe(first.body.file.id)
	expect(second.body.file).toMatchObject({ name: "a.txt", size: 4, type: "text/plain" })
	expect(await keys(room)).toEqual([`u/alice/r/${room}/${second.body.file.id}`])
})

test("a download serves ranges to the owner and 404 to anyone else", async () => {
	const room = fresh()
	const { body } = await put(room, "digits.txt", "0123456789")
	const url = `${origin}/api/files/${room}/${body.file.id}`
	const range = await fetch(url, { headers: { ...as("alice"), range: "bytes=3-5" } })
	expect(range.status).toBe(206)
	expect(range.headers.get("content-range")).toBe("bytes 3-5/10")
	expect(range.headers.get("cache-control")).toContain("immutable")
	expect(await range.text()).toBe("345")
	const tail = await fetch(url, { headers: { ...as("alice"), range: "bytes=-2" } })
	expect(await tail.text()).toBe("89")
	const bad = await fetch(url, { headers: { ...as("alice"), range: "bytes=20-" } })
	expect(bad.status).toBe(416)
	await bad.body?.cancel()
	const other = await fetch(url, { headers: as("bob") })
	expect(other.status).toBe(404)
	await other.body?.cancel()
	const anon = await fetch(url)
	expect(anon.status).toBe(401)
	await anon.body?.cancel()
})

test("bad paths and oversized declarations are refused", async () => {
	const room = fresh()
	expect((await put(room, "../x", "x")).status).toBe(400)
	const res = await fetch(`${origin}/api/files/${room}/uploads`, {
		method: "POST",
		headers: { ...as("alice"), "content-type": "application/json" },
		body: JSON.stringify({ path: "big.bin", type: "application/octet-stream", size: 2 ** 40, expect: "none" }),
	})
	expect(res.status).toBe(413)
	await res.body?.cancel()
})


test("an edit with a stale sha is refused and never overwrites the other writer", async () => {
	const room = fresh()
	await put(room, "a.txt", "one")
	const theirs = await put(room, "a.txt", "agent wrote this", await sha("one"))
	const stale = await put(room, "a.txt", "mine", await sha("one"))
	expect(stale.status).toBe(409)
	expect(stale.body.file.id).toBe(theirs.body.file.id)
	expect(await keys(room)).toEqual([`u/alice/r/${room}/${theirs.body.file.id}`])
	const fresher = await put(room, "a.txt", "mine", await sha("agent wrote this"))
	expect(fresher.status).toBe(200)
	expect(await keys(room)).toEqual([`u/alice/r/${room}/${fresher.body.file.id}`])
})

test("a write that does not say what it saw at the path is refused before anything is stored", async () => {
	const room = fresh()
	const res = await fetch(`${origin}/api/files/${room}?path=a.txt`, { method: "PUT", headers: { ...as("alice"), "content-type": "text/plain" }, body: "x" })
	expect(res.status).toBe(400)
	await res.body?.cancel()
	expect(await keys(room)).toEqual([])
})

test("none creates a file only when the path is empty", async () => {
	const room = fresh()
	expect((await put(room, "new.txt", "", "none")).status).toBe(200)
	expect((await put(room, "new.txt", "again", "none")).status).toBe(409)
})

test("a file has no still route, and new bytes at its path drop the old object", async () => {
	const room = fresh()
	const first = await put(room, "a.txt", "one")
	const id = first.body.file.id
	const put404 = await fetch(`${origin}/api/files/${room}/${id}/thumb`, { method: "PUT", headers: { ...as("alice"), "content-type": "image/webp" }, body: "pixels" })
	expect(put404.status).toBe(404)
	await put404.body?.cancel()
	const get404 = await fetch(`${origin}/api/files/${room}/${id}/thumb`, { headers: as("alice") })
	expect(get404.status).toBe(404)
	await get404.body?.cancel()
	expect(await keys(room)).toEqual([`u/alice/r/${room}/${id}`])
	const second = await put(room, "a.txt", "two!", await sha("one"))
	expect(await keys(room)).toEqual([`u/alice/r/${room}/${second.body.file.id}`])
})
