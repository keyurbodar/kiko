import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "@effect/vitest"
import { bitmapInfoHeader, bmpFromBgra } from "./bmp"

const WIDTH = 3
const HEIGHT = 2
const PADDING = 8
const STRIDE = WIDTH * 4 + PADDING
const COLORS = [
  [10, 20, 30],
  [40, 50, 60],
  [70, 80, 90],
  [100, 110, 120],
  [130, 140, 150],
  [160, 170, 180],
]
const PROBE = `
const bytes = await Bun.file(process.argv[1]).bytes()
const image = new Bun.Image(bytes)
if (process.argv[2] === "png") process.stdout.write(Buffer.from(await image.png().bytes()).toString("base64"))
else process.stdout.write(JSON.stringify(await image.metadata()))
`

type Meta = { width: number; height: number; format: string }

function pixels(stride: number): Uint8Array {
  const bytes = new Uint8Array(stride * HEIGHT).fill(0xee)
  COLORS.forEach((color, index) => {
    const at = Math.floor(index / WIDTH) * stride + (index % WIDTH) * 4
    bytes[at] = color[0]!
    bytes[at + 1] = color[1]!
    bytes[at + 2] = color[2]!
    bytes[at + 3] = 0xff
  })
  return bytes
}

function probe(bytes: Uint8Array, mode: "meta" | "png"): string {
  const dir = mkdtempSync(join(tmpdir(), "kiko-bmp-"))
  try {
    const file = join(dir, "shot.bmp")
    writeFileSync(file, bytes)
    return execFileSync("bun", ["-e", PROBE, file, mode], { encoding: "utf8" })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function metadata(bytes: Uint8Array): Promise<Meta> {
  if (typeof Bun !== "undefined") return await new Bun.Image(bytes).metadata()
  return JSON.parse(probe(bytes, "meta")) as Meta
}

async function png(bytes: Uint8Array): Promise<string> {
  if (typeof Bun !== "undefined") return Buffer.from(await new Bun.Image(bytes).png().bytes()).toString("base64")
  return probe(bytes, "png")
}

describe("bitmapInfoHeader", () => {
  it("describes a top-down 32-bit DIB", () => {
    const view = new DataView(bitmapInfoHeader(WIDTH, HEIGHT).buffer)
    expect(view.getUint32(0, true)).toBe(40)
    expect(view.getInt32(4, true)).toBe(WIDTH)
    expect(view.getInt32(8, true)).toBe(-HEIGHT)
    expect(view.getUint16(12, true)).toBe(1)
    expect(view.getUint16(14, true)).toBe(32)
    expect(view.getUint32(16, true)).toBe(0)
    expect(view.getUint32(20, true)).toBe(WIDTH * HEIGHT * 4)
  })
})

describe("bmpFromBgra", () => {
  it("writes a top-down 32-bit header", () => {
    const bytes = bmpFromBgra(pixels(STRIDE), WIDTH, HEIGHT, STRIDE)
    const view = new DataView(bytes.buffer)
    expect(String.fromCharCode(bytes[0]!, bytes[1]!)).toBe("BM")
    expect(view.getUint32(2, true)).toBe(bytes.length)
    expect(view.getUint32(10, true)).toBe(54)
    expect(view.getInt32(18, true)).toBe(WIDTH)
    expect(view.getInt32(22, true)).toBe(-HEIGHT)
    expect(view.getUint16(28, true)).toBe(32)
    expect(view.getUint32(34, true)).toBe(WIDTH * HEIGHT * 4)
  })

  it("lays rows out without stride padding", () => {
    const payload = bmpFromBgra(pixels(STRIDE), WIDTH, HEIGHT, STRIDE).subarray(54)
    const expected = new Uint8Array(WIDTH * HEIGHT * 4)
    COLORS.forEach((color, index) => expected.set([color[0]!, color[1]!, color[2]!, 0], index * 4))
    expect(payload).toEqual(expected)
  })

  it("decodes in Bun at the requested size", async () => {
    const meta = await metadata(bmpFromBgra(pixels(STRIDE), WIDTH, HEIGHT, STRIDE))
    expect(meta.width).toBe(WIDTH)
    expect(meta.height).toBe(HEIGHT)
    expect(meta.format).toBe("bmp")
  })

  it("decodes padded and tight images to the same picture", async () => {
    const padded = bmpFromBgra(pixels(STRIDE), WIDTH, HEIGHT, STRIDE)
    const tight = bmpFromBgra(pixels(WIDTH * 4), WIDTH, HEIGHT, WIDTH * 4)
    expect(await png(padded)).toBe(await png(tight))
  })
})
