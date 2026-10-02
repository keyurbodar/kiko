import { afterAll, beforeAll, expect, test } from "bun:test"
import { Miniflare } from "miniflare"

// Upload, download, and the room index against real R2 and a real RoomDO in workerd.
let mf: Miniflare
let origin: string

beforeAll(async () => {
	const built = await Bun.build({
		entrypoints: [new URL("./files-worker.ts", import.meta.url).pathname],
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

async function put(room: string, path: string, body: string, user = "alice") {
	const res = await fetch(`${origin}/api/files/${room}?path=${encodeURIComponent(path)}`, {
		method: "PUT",
		headers: { ...as(user), "content-type": "text/plain" },
		body,
	})
	return { status: res.status, body: (await res.json()) as FileBody }
}

const keys = async (room: string) =>
	((await (await fetch(`${origin}/keys`)).json()) as string[]).filter((k) => k.includes(room))

test("the same bytes at the same path store one object", async () => {
	const room = fresh()
	const first = await put(room, "notes/a.txt", "hello")
	const second = await put(room, "notes/a.txt", "hello")
	expect(first.status).toBe(200)
	expect(second.body.file).toEqual(first.body.file)
	expect(await keys(room)).toEqual([`u/alice/r/${room}/${first.body.file.id}`])
})

test("new bytes at a path replace the row and delete the old object", async () => {
	const room = fresh()
	const first = await put(room, "a.txt", "one")
	const second = await put(room, "a.txt", "two!")
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
		body: JSON.stringify({ path: "big.bin", type: "application/octet-stream", size: 2 ** 40 }),
	})
	expect(res.status).toBe(413)
	await res.body?.cancel()
})
