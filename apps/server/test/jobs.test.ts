import { expect, test } from "bun:test"
import { encode as encodePng } from "fast-png"
import jpeg from "jpeg-js"
import { thumbHashToAverageRGBA } from "thumbhash"
import { handleAttachmentJob } from "../src/jobs/attachment"
import { consume, retryDelay } from "../src/jobs/consumer"
import { computeThumbhash, readDimensions } from "../src/jobs/image"

function solidPng(w: number, h: number, rgb: [number, number, number]): Uint8Array {
	const data = new Uint8Array(w * h * 3)
	for (let i = 0; i < w * h; i++) data.set(rgb, i * 3)
	return encodePng({ width: w, height: h, data, channels: 3, depth: 8 })
}

function solidJpeg(w: number, h: number, rgb: [number, number, number]): Uint8Array {
	const data = new Uint8Array(w * h * 4)
	for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4)
	return jpeg.encode({ width: w, height: h, data }, 90).data
}

test("dimensions come from the header of each format", () => {
	expect(readDimensions(solidPng(33, 21, [1, 2, 3]))).toEqual({ width: 33, height: 21 })
	expect(readDimensions(solidJpeg(40, 17, [1, 2, 3]))).toEqual({ width: 40, height: 17 })
	expect(readDimensions(Uint8Array.from([...Buffer.from("GIF89a"), 5, 0, 7, 0, 0, 0]))).toEqual({ width: 5, height: 7 })
	const riff = (kind: string, body: number[]) =>
		Uint8Array.from([
			...Buffer.from("RIFF"),
			0, 0, 0, 0,
			...Buffer.from("WEBP"),
			...Buffer.from(kind),
			0, 0, 0, 0,
			...body,
			...new Array(20).fill(0),
		])
	expect(readDimensions(riff("VP8X", [0, 0, 0, 0, 99, 0, 0, 49, 0, 0]))).toEqual({ width: 100, height: 50 })
	expect(readDimensions(riff("VP8L", [0x2f, 0x63, 0x40, 0x0c, 0x00]))).toEqual({ width: 100, height: 50 })
	expect(readDimensions(Buffer.from("not an image at all, just text"))).toBeNull()
})

test("a thumbhash from a PNG and a JPEG matches the image's colour", () => {
	for (const [bytes, size] of [
		[solidPng(300, 200, [250, 20, 20]), { width: 300, height: 200 }],
		[solidJpeg(120, 90, [250, 20, 20]), { width: 120, height: 90 }],
	] as const) {
		const hash = computeThumbhash(bytes, size)
		expect(hash).toMatch(/^[A-Za-z0-9+/]+$/)
		const avg = thumbHashToAverageRGBA(Uint8Array.from(atob(hash!), (c) => c.charCodeAt(0)))
		expect(avg.r).toBeGreaterThan(0.85)
		expect(avg.g).toBeLessThan(0.2)
		expect(avg.b).toBeLessThan(0.2)
	}
})

test("a broken image gives no thumbhash and does not throw", () => {
	const png = solidPng(10, 10, [1, 2, 3])
	expect(computeThumbhash(png.subarray(0, 40), { width: 10, height: 10 })).toBeNull()
})

type Meta = { width?: number; height?: number; thumbhash?: string }
function fakeEnv(image: Uint8Array, start: Meta = {}) {
	let meta: Meta = { ...start }
	const calls = { changed: 0 }
	const room = {
		fileMeta: async () => ({ r2Key: "k", size: image.length, type: "image/png", ...meta }),
		// Fills empty fields only, like RoomFiles.fillMeta.
		setFileMeta: async (_: string, patch: Meta) => {
			const next = { ...patch, ...meta }
			const changed = JSON.stringify(next) !== JSON.stringify(meta)
			meta = next
			if (changed) calls.changed++
			return changed
		},
	}
	const env = {
		ROOM: { idFromName: (n: string) => n, get: () => room },
		FILES: { get: async () => ({ arrayBuffer: async () => image.buffer.slice(image.byteOffset, image.byteOffset + image.length) }) },
	}
	return { env: env as never, calls, meta: () => meta }
}

const job = { type: "attachment", userId: "u1", roomId: "01JZ8Q4T6M0000000000000001", fileId: "f1" } as const

test("a repeated attachment job changes nothing", async () => {
	const t = fakeEnv(solidPng(30, 20, [9, 9, 9]))
	expect(await handleAttachmentJob(job, t.env, 1)).toBe("updated")
	const after = structuredClone(t.meta())
	expect(after.width).toBe(30)
	expect(after.thumbhash).toBeTruthy()
	expect(await handleAttachmentJob(job, t.env, 1)).toBe("unchanged")
	expect(t.meta()).toEqual(after)
	expect(t.calls.changed).toBe(1)
})

test("a job computes only what the client did not send", async () => {
	const t = fakeEnv(solidPng(30, 20, [9, 9, 9]), { width: 999, height: 888 })
	await handleAttachmentJob(job, t.env, 1)
	expect(t.meta().width).toBe(999)
	expect(t.meta().thumbhash).toBeTruthy()
})

function batch(body: unknown, attempts: number) {
	const seen = { ack: 0, retry: [] as unknown[] }
	const message = { body, attempts, ack: () => seen.ack++, retry: (o: unknown) => seen.retry.push(o) }
	return { b: { messages: [message] } as never, seen }
}

test("a job that throws is retried with a growing delay, then succeeds on the third delivery", async () => {
	const t = fakeEnv(solidPng(30, 20, [9, 9, 9]))
	const flaky = { ...job, failures: 2 }
	const first = batch(flaky, 1)
	await consume(first.b, t.env)
	const second = batch(flaky, 2)
	await consume(second.b, t.env)
	const third = batch(flaky, 3)
	await consume(third.b, t.env)
	expect([first.seen.retry, second.seen.retry]).toEqual([[{ delaySeconds: 1 }], [{ delaySeconds: 2 }]])
	expect([first.seen.ack, second.seen.ack, third.seen.ack]).toEqual([0, 0, 1])
	expect(t.meta().width).toBe(30)
})

test("an unknown job is dropped, not retried forever", async () => {
	const t = fakeEnv(new Uint8Array())
	const x = batch({ type: "nope" }, 1)
	await consume(x.b, t.env)
	expect(x.seen).toEqual({ ack: 1, retry: [] })
	expect(retryDelay(20)).toBe(60)
})
