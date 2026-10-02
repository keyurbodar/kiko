import { deflateSync } from "node:zlib"
import type { FileRef, RoomToClient } from "@kiko/protocol"
import { expectEqual, VerifyError } from "../client"
import type { Suite } from "../runner"

// Architecture section 7.9. An image upload gains width, height, and a thumbhash from the
// queue within 5 seconds. A client that sends all three gets no job. A client that sends
// only dimensions keeps them and gets the thumbhash. A job that fails twice succeeds on
// the third delivery. That last step needs the Worker started with NODE_ENV=development.

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

const crcTable = Array.from({ length: 256 }, (_, n) => {
	let c = n
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
	return c >>> 0
})
function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff
	for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8)
	return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length)
	const view = new DataView(out.buffer)
	view.setUint32(0, data.length)
	out.set(new TextEncoder().encode(type), 4)
	out.set(data, 8)
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
	return out
}

/** A w by h RGB gradient PNG. `seed` makes the bytes differ between files. */
function png(w: number, h: number, seed: number): Uint8Array<ArrayBuffer> {
	const raw = new Uint8Array((w * 3 + 1) * h)
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const o = y * (w * 3 + 1) + 1 + x * 3
			raw[o] = (x * 4 + seed) & 255
			raw[o + 1] = (y * 5) & 255
			raw[o + 2] = (seed * 37) & 255
		}
	}
	const header = new Uint8Array(13)
	const view = new DataView(header.buffer)
	view.setUint32(0, w)
	view.setUint32(4, h)
	header.set([8, 2, 0, 0, 0], 8)
	const parts = [
		new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", new Uint8Array()),
	]
	return new Uint8Array(Buffer.concat(parts))
}

const suite: Suite = {
	name: "attachments",
	async run(v) {
		const alice = await v.as("attachments-alice")
		const roomId = ulid()
		const base = new URL(`api/files/${roomId}`, v.url.endsWith("/") ? v.url : `${v.url}/`)
		const room = await alice.room(roomId)
		await room.expect({ t: "events" })

		const upload = async (path: string, bytes: Uint8Array<ArrayBuffer>, headers: Record<string, string> = {}) => {
			const res = await fetch(`${base}?path=${encodeURIComponent(path)}`, {
				method: "PUT",
				headers: { cookie: alice.cookie, "content-type": "image/png", ...headers },
				body: bytes,
			})
			if (!res.ok) throw new VerifyError(`upload failed with ${res.status}: ${await res.text()}`)
			return ((await res.json()) as { file: FileRef }).file
		}
		const fileEvent = (id: string, done: (f: FileRef) => boolean) => (f: RoomToClient) =>
			f.t === "events" && f.events.some((e) => e.t === "file" && e.file.id === id && done(e.file))
		const hasAll = (f: FileRef) => !!f.width && !!f.height && !!f.thumbhash

		// the server computes all three
		const plain = await upload("img/plain.png", png(64, 48, 1))
		expectEqual(plain.width, undefined, "a fresh upload has no width")
		const started = Date.now()
		await room.expect(fileEvent(plain.id, (f) => hasAll(f) && f.width === 64 && f.height === 48), 5000)
		console.log(`  metadata arrived in ${Date.now() - started} ms`)

		// the client sends all three, so no job runs and nothing changes
		const sent = await upload("img/sent.png", png(32, 32, 2), {
			"x-kiko-width": "32",
			"x-kiko-height": "32",
			"x-kiko-thumbhash": "1QcSHQRnh493V4dIh4eXh1h4kJUI",
		})
		expectEqual([sent.width, sent.height, sent.thumbhash], [32, 32, "1QcSHQRnh493V4dIh4eXh1h4kJUI"], "the client values")
		await room.expect(fileEvent(sent.id, () => true))
		await room.expectNone(fileEvent(sent.id, () => true), 1500)

		// the client sends only dimensions, the job keeps them and adds the thumbhash
		const partial = await upload("img/partial.png", png(40, 40, 3), { "x-kiko-width": "999", "x-kiko-height": "888" })
		await room.expect(fileEvent(partial.id, () => true))
		await room.expect(fileEvent(partial.id, (f) => f.width === 999 && f.height === 888 && !!f.thumbhash), 5000)

		// a job that fails twice succeeds on the third delivery
		const flaky = await upload("img/flaky.png", png(50, 20, 4), { "x-kiko-test-job-failures": "2" })
		await room.expect(fileEvent(flaky.id, () => true))
		await room.expect(fileEvent(flaky.id, (f) => f.width === 50 && f.height === 20 && !!f.thumbhash), 30_000)
	},
}

export default suite
