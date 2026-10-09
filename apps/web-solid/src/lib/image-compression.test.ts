import { describe, expect, test } from "bun:test"
import { type Codec, type Decoded, encodeSizes, MAX_COMPRESSIBLE_SOURCE_BYTES, prepareImageForAttachment, renamed } from "./image-compression"

// The re-encode ladder of t3code, against a fake codec that records every attempt and makes a
// blob whose size the test chooses.

const MB = 1024 * 1024
type Attempt = { width: number; height: number; type: string; quality: number }

function fakeCodec(source: { width: number; height: number }, sizeOf: (a: Attempt) => number | null, options: { webp?: boolean; decodeFails?: boolean } = {}) {
  const attempts: Attempt[] = []
  let closed = 0
  const codec: Codec<Decoded> = {
    async decode() {
      if (options.decodeFails) throw new Error("not an image")
      return { ...source, close: () => void closed++ }
    },
    async encode(_, size, type, quality) {
      const a = { ...size, type, quality }
      attempts.push(a)
      if (type === "image/webp" && options.webp === false) return null
      const bytes = sizeOf(a)
      return bytes === null ? null : new Blob([new Uint8Array(bytes)], { type })
    },
  }
  return { codec, attempts, closed: () => closed }
}

const picture = (size: number, name = "shot.png", type = "image/png") => new File([new Uint8Array(size)], name, { type })

describe("preparing a picture", () => {
  test("one within the limit passes through untouched", async () => {
    const file = picture(10 * MB)
    const { codec, attempts } = fakeCodec({ width: 4000, height: 3000 }, () => 1)
    const out = await prepareImageForAttachment(file, 10 * MB, codec)
    expect(out).toEqual({ ok: true, file, recompressed: false })
    expect(attempts).toEqual([])
  })

  test("one over it walks the quality ladder at a 2048 px long edge, as WebP", async () => {
    const { codec, attempts, closed } = fakeCodec({ width: 4000, height: 3000 }, (a) => (a.quality <= 0.78 ? 5 * MB : 11 * MB))
    const out = await prepareImageForAttachment(picture(12 * MB), 10 * MB, codec)
    expect(attempts.map((a) => [a.width, a.height, a.type, a.quality])).toEqual([
      [2048, 1536, "image/webp", 0.92],
      [2048, 1536, "image/webp", 0.85],
      [2048, 1536, "image/webp", 0.78],
    ])
    expect(out.ok && [out.file.name, out.file.type, out.file.size, out.recompressed]).toEqual(["shot.webp", "image/webp", 5 * MB, true])
    expect(closed()).toBe(1)
  })

  test("a browser without WebP gets JPEG, and the lowest quality failing drops to smaller sizes", async () => {
    const { codec, attempts } = fakeCodec({ width: 3000, height: 1000 }, (a) => (a.width <= 1127 ? MB : 20 * MB), { webp: false })
    const out = await prepareImageForAttachment(picture(12 * MB, "pano.png"), 10 * MB, codec)
    const jpeg = attempts.filter((a) => a.type === "image/jpeg")
    expect([...new Set(jpeg.map((a) => a.width))]).toEqual([2048, 1536, 1126])
    expect(jpeg.filter((a) => a.width === 2048).map((a) => a.quality)).toEqual([0.92, 0.85, 0.78, 0.68])
    expect(out.ok && [out.file.name, out.file.type]).toEqual(["pano.jpg", "image/jpeg"])
  })

  test("one that never fits is too large, one that cannot be decoded is unreadable, a huge source is not decoded", async () => {
    const never = fakeCodec({ width: 5000, height: 5000 }, () => 20 * MB)
    expect(await prepareImageForAttachment(picture(12 * MB), 10 * MB, never.codec)).toEqual({ ok: false, reason: "too-large" })
    expect(never.attempts.length).toBe(12)
    const broken = fakeCodec({ width: 1, height: 1 }, () => 1, { decodeFails: true })
    expect(await prepareImageForAttachment(picture(12 * MB), 10 * MB, broken.codec)).toEqual({ ok: false, reason: "unreadable" })
    const huge = fakeCodec({ width: 1, height: 1 }, () => 1)
    expect(await prepareImageForAttachment(picture(MAX_COMPRESSIBLE_SOURCE_BYTES + 1), 10 * MB, huge.codec)).toEqual({ ok: false, reason: "too-large" })
    expect(huge.attempts).toEqual([])
  })

  test("the sizes keep the shape and never grow a small picture", () => {
    expect(encodeSizes({ width: 800, height: 600 })).toEqual([
      { width: 800, height: 600 },
      { width: 600, height: 450 },
      { width: 440, height: 330 },
    ])
    expect(renamed("photo.final.png", "image/jpeg")).toBe("photo.final.jpg")
    expect(renamed("noext", "image/webp")).toBe("noext.webp")
  })
})
