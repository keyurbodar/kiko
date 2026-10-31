import { describe, expect, it } from "@effect/vitest"
import { drain, drainJpeg, type Pumpable } from "./captures"

const SOI = [0xff, 0xd8]
const EOI = [0xff, 0xd9]

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values)
}

describe("jpeg reassembly", () => {
  it("emits complete frames and keeps the tail", () => {
    const frames: number[][] = []
    const rest = drainJpeg(bytes(), bytes(...SOI, 1, 2, ...EOI, 9), 1024, (jpeg) => frames.push(Array.from(jpeg)))
    expect(frames).toEqual([[...SOI, 1, 2, ...EOI]])
    expect(Array.from(rest)).toEqual([9])
  })

  it("keeps an incomplete frame under the limit", () => {
    const rest = drainJpeg(bytes(...SOI), bytes(1, 2, 3), 1024, () => {})
    expect(Array.from(rest)).toEqual([...SOI, 1, 2, 3])
  })

  it("drops a frame that never ends once it passes the limit", () => {
    const frames: Uint8Array[] = []
    const rest = drainJpeg(bytes(...SOI), new Uint8Array(8).fill(1), 8, (jpeg) => frames.push(jpeg))
    expect(rest.byteLength).toBe(0)
    expect(frames).toEqual([])
  })

  it("resyncs on the next frame after dropping", () => {
    const dropped = drainJpeg(bytes(...SOI), new Uint8Array(8).fill(1), 8, () => {})
    const frames: number[][] = []
    const rest = drainJpeg(dropped, bytes(...SOI, 7, ...EOI), 1024, (jpeg) => frames.push(Array.from(jpeg)))
    expect(frames).toEqual([[...SOI, 7, ...EOI]])
    expect(rest.byteLength).toBe(0)
  })
})

function gated(): { proc: Pumpable; order: string[] } {
  const order: string[] = []
  let release = (): void => {}
  const opened = new Promise<void>((resolve) => {
    release = resolve
  })
  const stderr = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        order.push("stderr")
        controller.enqueue(new TextEncoder().encode("ffmpeg exploded"))
        controller.close()
        release()
      },
    },
    { highWaterMark: 0 },
  )
  async function* stdout(): AsyncGenerator<Uint8Array> {
    await opened
    order.push("stdout")
    yield new Uint8Array([1, 2, 3])
  }
  return { proc: { stdout: stdout(), stderr, exited: Promise.resolve(0) }, order }
}

describe("capture pump", () => {
  it("drains stderr while stdout is still open", async () => {
    const { proc, order } = gated()
    const chunks: Uint8Array[] = []
    const result = await drain(proc, (chunk) => {
      chunks.push(chunk)
      return true
    })
    expect(Array.from(chunks[0]!)).toEqual([1, 2, 3])
    expect(result).toEqual({ code: 0, tail: "ffmpeg exploded" })
    expect(order).toEqual(["stderr", "stdout"])
  })
})
