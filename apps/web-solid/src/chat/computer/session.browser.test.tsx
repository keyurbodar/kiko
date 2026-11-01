import { describe, expect, it, vi } from "vitest"
import { startSession, type Display, type Mode } from "./session"

const env = vi.hoisted(() => {
  const sockets: Socket[] = []
  const sent: string[] = []
  const calls: unknown[] = []
  class Socket {
    static OPEN = 1
    static CLOSED = 3
    readyState = 0
    binaryType = "arraybuffer"
    private readonly listeners = new Map<string, ((event: unknown) => void)[]>()
    constructor(
      readonly url: string,
      readonly protocols: string[],
    ) {
      sockets.push(this)
    }
    addEventListener(type: string, fn: (event: never) => void): void {
      const list = this.listeners.get(type) ?? []
      list.push(fn as (event: unknown) => void)
      this.listeners.set(type, list)
    }
    send(data: string): void {
      sent.push(data)
    }
    close(): void {
      this.readyState = 3
      this.fire("close", {})
    }
    open(): void {
      this.readyState = 1
      this.fire("open", {})
    }
    message(data: ArrayBuffer): void {
      this.fire("message", { data })
    }
    private fire(type: string, event: unknown): void {
      for (const fn of this.listeners.get(type) ?? []) fn(event)
    }
  }
  return { Socket, sockets, sent, calls }
})

vi.mock("../../state/runtime", () => ({
  liveSocket: () => ({ url: "ws://kiko.test/api/pc/live/pc-1", protocols: ["kiko", "token"] }),
  owner: { commands: {} },
  run: (_command: unknown, input: unknown) => {
    env.calls.push(input)
    return Promise.resolve({})
  },
}))

vi.mock("../../state/user", () => ({ onUserSignal: () => () => {} }))

const HEADER = 14
const DISPLAY: Display = { width: 1280, height: 800, scale: 2 }

function frame(seq: number, width = 640, height = 400): ArrayBuffer {
  const bytes = new Uint8Array(HEADER + 4)
  const view = new DataView(bytes.buffer)
  view.setUint8(0, 1)
  view.setUint8(1, 1)
  view.setUint16(2, width, true)
  view.setUint16(4, height, true)
  view.setUint32(6, seq, true)
  view.setUint16(10, 0xffff, true)
  view.setUint16(12, 0xffff, true)
  bytes.set([1, 2, 3, 4], HEADER)
  return bytes.buffer
}

function harness() {
  const canvas = document.createElement("canvas")
  const video = document.createElement("video")
  const draws: number[] = []
  const modes: Mode[] = []
  const sizes: { width: number; height: number }[] = []
  vi.spyOn(canvas, "getContext").mockReturnValue({
    drawImage: () => draws.push(1),
  } as unknown as CanvasRenderingContext2D)
  const session = startSession("pc-1", {
    video,
    canvas,
    display: DISPLAY,
    onMode: (mode) => modes.push(mode),
    onSize: (width, height) => sizes.push({ width, height }),
    onCursor: () => {},
  })
  return { session, canvas, draws, modes, sizes }
}

const acks = () => env.sent.filter((message) => message.includes('"ack"')).map((message) => JSON.parse(message).seq)
const hello = () => JSON.parse(env.sent[0] ?? "{}")

function stubbed(): Disposable {
  env.sockets.length = 0
  env.sent.length = 0
  env.calls.length = 0
  vi.stubGlobal("WebSocket", env.Socket)
  vi.stubGlobal("createImageBitmap", async () => ({ close() {} }))
  vi.stubGlobal(
    "RTCPeerConnection",
    class {
      addTransceiver() {
        return { receiver: {} }
      }
      createDataChannel() {
        return { addEventListener: () => undefined, close: () => undefined }
      }
      addEventListener = () => undefined
      createOffer() {
        return Promise.resolve({ sdp: "" })
      }
      setLocalDescription() {
        return Promise.resolve()
      }
      getStats() {
        return Promise.resolve(new Map())
      }
      close = () => undefined
    },
  )
  return { [Symbol.dispose]: () => vi.unstubAllGlobals() }
}

describe("relay pump", () => {
  it("asks for the physical width as soon as the socket opens", () => {
    using _stubs = stubbed()
    const { session } = harness()
    env.sockets[0]?.open()
    expect(hello()).toEqual({ t: "live", fps: 15, maxWidth: 2560, quality: 70 })
    expect(env.calls).toContainEqual({ pcId: "pc-1", on: true, mode: "rtc" })
    session.close()
  })

  it("paints a frame and only then acks it", async () => {
    using _stubs = stubbed()
    const { session, canvas, draws, modes, sizes } = harness()
    env.sockets[0]?.open()
    env.sockets[0]?.message(frame(1))

    await expect.poll(() => acks()).toEqual([1])
    expect(draws.length).toBe(1)
    expect(canvas.width).toBe(640)
    expect(canvas.height).toBe(400)
    expect(sizes.at(-1)).toEqual({ width: 640, height: 400 })
    expect(modes.at(-1)).toBe("relay")
    session.close()
  })

  it("keeps only the newest frame while a paint is in flight", async () => {
    using _stubs = stubbed()
    const waiting: (() => void)[] = []
    vi.stubGlobal("createImageBitmap", () => new Promise((resolve) => waiting.push(() => resolve({ close() {} }))))
    const { session, draws } = harness()
    env.sockets[0]?.open()
    env.sockets[0]?.message(frame(1))
    env.sockets[0]?.message(frame(2))
    env.sockets[0]?.message(frame(3))

    await expect.poll(() => waiting.length).toBe(1)
    waiting.shift()?.()
    await expect.poll(() => acks()).toEqual([1])
    await expect.poll(() => waiting.length).toBe(1)
    waiting.shift()?.()
    await expect.poll(() => acks()).toEqual([1, 3])
    expect(draws.length).toBe(2)
    session.close()
  })

  it("drops a frame older than the one already painted", async () => {
    using _stubs = stubbed()
    const decode = vi.fn(async () => ({ close() {} }))
    vi.stubGlobal("createImageBitmap", decode)
    const { session } = harness()
    env.sockets[0]?.open()
    env.sockets[0]?.message(frame(4))
    await expect.poll(() => acks()).toEqual([4])
    env.sockets[0]?.message(frame(2))

    expect(decode).toHaveBeenCalledTimes(1)
    expect(acks()).toEqual([4])
    session.close()
  })
})
