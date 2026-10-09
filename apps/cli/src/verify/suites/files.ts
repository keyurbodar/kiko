import { createHash } from "node:crypto"
import type { RoomToClient } from "@yuki/protocol"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"

// Architecture section 18.1. Uploads a 30 MB file in parts, reads a byte range from
// the middle, sees the file event on the room socket, checks that another user gets
// 404, and that the same bytes at the same path keep one file.

const SIZE = 30_000_000
const PART = 10 * 1024 * 1024
const RANGE = [15_000_000, 15_065_535] as const

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
function ulid(): string {
	let time = Date.now()
	let head = ""
	for (let i = 0; i < 10; i++) {
		head = CROCKFORD[time % 32] + head
		time = Math.floor(time / 32)
	}
	return head + Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => CROCKFORD[b % 32]).join("")
}

function randomBytes(size: number): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(size)
	for (let i = 0; i < size; i += 65_536) crypto.getRandomValues(out.subarray(i, Math.min(size, i + 65_536)))
	return out
}

type FileRef = { id: string; name: string; size: number; type: string }

const suite: Suite = {
	name: "files",
	async run(v) {
		const alice = await v.as("files-alice")
		const bob = await v.as("files-bob")
		const roomId = ulid()
		const base = new URL(`api/files/${roomId}/`, v.url.endsWith("/") ? v.url : `${v.url}/`)
		const call = async (path: string, init: RequestInit & { as?: typeof alice } = {}) => {
			const res = await fetch(new URL(path, base), {
				...init,
				headers: { cookie: (init.as ?? alice).cookie, ...(init.headers as Record<string, string>) },
			})
			return res
		}
		const ok = async <T>(res: Response, what: string): Promise<T> => {
			if (!res.ok) throw new VerifyError(`${what} failed with ${res.status}: ${await res.text()}`)
			return (await res.json()) as T
		}

		const room = await alice.room(roomId)
		await room.expect({ t: "events" })

		// a multipart upload of 30 MB
		const bytes = randomBytes(SIZE)
		const { fileId, uploadId } = await ok<{ fileId: string; uploadId: string }>(
			await call("uploads", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ path: "media/big.bin", type: "application/octet-stream", size: SIZE, expect: "none" }),
			}),
			"create",
		)
		const parts: { partNumber: number; etag: string }[] = []
		for (let offset = 0, n = 1; offset < SIZE; offset += PART, n++) {
			const chunk = bytes.subarray(offset, Math.min(SIZE, offset + PART))
			parts.push(
				await ok(await call(`uploads/${fileId}/${n}?uploadId=${encodeURIComponent(uploadId)}`, { method: "PUT", body: chunk.slice() }), `part ${n}`),
			)
		}
		expectEqual(parts.length, 3, "the number of parts")
		const { file } = await ok<{ file: FileRef }>(
			await call(`uploads/${fileId}?uploadId=${encodeURIComponent(uploadId)}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ parts }),
			}),
			"complete",
		)
		expectEqual(file, { id: fileId, name: "media/big.bin", size: SIZE, type: "application/octet-stream" }, "the file")

		// the room socket gets the file event
		const isFile = (f: RoomToClient) => f.t === "events" && f.events.some((e) => e.t === "file" && e.file.id === fileId)
		await room.expect(isFile, 10_000)

		// a byte range from the middle
		const ranged = await call(fileId, { headers: { range: `bytes=${RANGE[0]}-${RANGE[1]}` } })
		expectEqual(ranged.status, 206, "the range status")
		expectEqual(ranged.headers.get("content-range"), `bytes ${RANGE[0]}-${RANGE[1]}/${SIZE}`, "the content range")
		if (!ranged.headers.get("cache-control")?.includes("immutable")) throw new VerifyError("the download is not immutable")
		const got = new Uint8Array(await ranged.arrayBuffer())
		if (!Buffer.from(got).equals(Buffer.from(bytes.subarray(RANGE[0], RANGE[1] + 1)))) {
			throw new VerifyError(`the range bytes differ (got ${got.length} bytes)`)
		}

		// another user gets 404 for the same url
		const stranger = await call(fileId, { as: bob })
		expectEqual(stranger.status, 404, "another user's status")
		await stranger.body?.cancel()

		// the same bytes at the same path keep the first file and send no event
		const small = new TextEncoder().encode("same bytes")
		const first = await ok<{ file: FileRef }>(await alice.putFile(roomId, "notes/a.txt", small), "the first small upload")
		await room.expect((f) => f.t === "events" && f.events.some((e) => e.t === "file" && e.file.id === first.file.id))
		const seen = createHash("sha256").update(small).digest("hex")
		const second = await ok<{ file: FileRef }>(await alice.putFile(roomId, "notes/a.txt", small, { expect: seen }), "the second small upload")
		expectEqual(second.file, first.file, "the repeated upload")
		await room.expectNone((f) => f.t === "events" && f.events.some((e) => e.t === "file"), 500)
	},
}

export default suite
