import { describe, expect, it, vi } from "vitest"
import { startMjpeg, type MjpegOptions } from "./captures"

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])

function talking(spawns: string[][]) {
  return (args: string[]) => {
    spawns.push(args)
    return {
      pid: spawns.length,
      exitCode: null,
      stdout: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(JPEG)
        },
      }),
      stderr: new ReadableStream<Uint8Array>({ start() {} }),
      exited: new Promise<number>(() => {}),
      kill: () => {},
    }
  }
}

function silent(spawns: string[][]) {
  return (args: string[]) => {
    spawns.push(args)
    return {
      pid: spawns.length,
      exitCode: null,
      stdout: new ReadableStream<Uint8Array>({ start() {} }),
      stderr: new ReadableStream<Uint8Array>({ start() {} }),
      exited: new Promise<number>(() => {}),
      kill: () => {},
    }
  }
}

function capture(overrides: Partial<MjpegOptions> & { spawn: MjpegOptions["spawn"] }) {
  const failures: string[] = []
  const started = startMjpeg({
    ffmpeg: "ffmpeg",
    screen: { width: 100, height: 50 },
    fps: 15,
    maxWidth: 100,
    quality: 70,
    handlers: { frame: () => {}, failed: (reason) => failures.push(reason) },
    ...overrides,
  })
  return { started, failures }
}

describe("a capture that never sends a frame", () => {
  it("is started again", () => {
    vi.useFakeTimers()
    const spawns: string[][] = []
    const { started } = capture({ spawn: silent(spawns) })
    expect(spawns).toHaveLength(1)

    vi.advanceTimersByTime(5_000)

    expect(spawns).toHaveLength(2)
    started.stop()
    vi.useRealTimers()
  })

  it("gives up after a few tries and says why", () => {
    vi.useFakeTimers()
    const spawns: string[][] = []
    const { started, failures } = capture({ spawn: silent(spawns) })

    for (let tick = 0; tick < 5; tick++) vi.advanceTimersByTime(5_000)

    expect(spawns).toHaveLength(5)
    expect(failures).toEqual(["ffmpeg sent no frames"])
    started.stop()
    vi.useRealTimers()
  })

  it("is left alone once a frame arrives", async () => {
    vi.useFakeTimers()
    const spawns: string[][] = []
    const frames: Uint8Array[] = []
    const { started } = capture({
      spawn: talking(spawns),
      handlers: { frame: (jpeg) => frames.push(jpeg), failed: () => {} },
    })
    await vi.advanceTimersByTimeAsync(5_000)

    expect(frames).toHaveLength(1)
    expect(spawns).toHaveLength(1)
    started.stop()
    vi.useRealTimers()
  })

  it("is not started again once it stops", () => {
    vi.useFakeTimers()
    const spawns: string[][] = []
    const { started } = capture({ spawn: silent(spawns) })

    started.stop()
    vi.advanceTimersByTime(20_000)

    expect(spawns).toHaveLength(1)
    vi.useRealTimers()
  })
})
