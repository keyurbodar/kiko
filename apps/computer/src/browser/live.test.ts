import { decodeBrowserFrame } from "@kiko/computer/frame"
import type { FromDaemon, ToDaemon } from "@kiko/computer/wire"
import { describe, expect, it, vi } from "vitest"
import { createBrowserLive, type StreamSocket } from "./live"

class FakeSocket implements StreamSocket {
  static all: FakeSocket[] = []
  readyState = 1
  readonly sent: string[] = []
  private readonly listeners = new Map<string, ((event: { data?: unknown }) => void)[]>()

  constructor(readonly url: string) {
    FakeSocket.all.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = 3
  }

  addEventListener(type: string, handler: (event: { data?: unknown }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), handler])
  }

  emit(type: string, event: { data?: unknown } = {}) {
    for (const handler of this.listeners.get(type) ?? []) handler(event)
  }

  open() {
    this.emit("open")
  }

  push(value: unknown) {
    this.emit("message", { data: JSON.stringify(value) })
  }

  json(): Record<string, unknown>[] {
    return this.sent.map((text) => JSON.parse(text) as Record<string, unknown>)
  }
}

function jpeg(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03, 0, 0, 0, 0, 0, 0, 0, 0])
  bytes[7] = height >> 8
  bytes[8] = height & 0xff
  bytes[9] = width >> 8
  bytes[10] = width & 0xff
  return bytes
}

const frame = (seq: number, width = 1000, height = 500) => ({
  type: "frame",
  seq,
  data: Buffer.from(jpeg(width, height)).toString("base64"),
  metadata: { deviceWidth: 1000, deviceHeight: 500 },
})

function harness(options: { holder?: "agent" | "human"; stream?: () => Promise<string> } = {}) {
  const frames: FromDaemon[] = []
  const binaries: Uint8Array<ArrayBuffer>[] = []
  const tabs: string[] = []
  FakeSocket.all = []
  const live = createBrowserLive({
    stream: (tab) => {
      tabs.push(tab)
      return (options.stream ?? (() => Promise.resolve("ws://127.0.0.1:9223")))()
    },
    send: (frame) => frames.push(frame),
    sendBinary: (bytes) => binaries.push(bytes),
    holder: () => options.holder ?? "agent",
    warn: () => {},
    open: (url) => new FakeSocket(url),
  })
  const open = (extra: Partial<Extract<ToDaemon, { t: "browser" }>> = {}) =>
    live.open({ t: "browser", on: true, id: "a1", tab: "T1", ...extra })
  const socket = () => FakeSocket.all.at(-1) as FakeSocket
  return { live, frames, binaries, tabs, open, socket }
}

describe("browser live", () => {
  it("opens one stream for the watched tab and closes it when the viewer leaves", async () => {
    const { live, frames, tabs, open, socket } = harness()
    expect(FakeSocket.all).toHaveLength(0)

    open()
    await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(1))
    expect(tabs).toEqual(["T1"])
    expect(socket().url).toBe("ws://127.0.0.1:9223")

    socket().open()
    expect(socket().json()[0]).toEqual({ type: "config", pacing: "ack", maxFps: 30 })

    socket().push({
      type: "status",
      connected: true,
      screencasting: true,
      viewportWidth: 1000,
      viewportHeight: 500,
    })
    expect(frames[0]).toEqual({
      t: "browser",
      id: "a1",
      event: { type: "start", tab: "T1", width: 1000, height: 500, viewportWidth: 1000, viewportHeight: 500 },
    })

    live.open({ t: "browser", on: false, id: "a1" })
    expect(socket().readyState).toBe(3)
  })

  it("forwards a stream frame as one binary frame with the picture's own size", async () => {
    const { binaries, open, socket } = harness()
    open()
    await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(1))

    socket().push(frame(7))

    await vi.waitFor(() => expect(binaries.length).toBe(1))
    expect(decodeBrowserFrame(binaries[0] as Uint8Array)?.header).toEqual({
      id: "a1",
      tab: "T1",
      seq: 1,
      width: 1000,
      height: 500,
      viewportWidth: 1000,
      viewportHeight: 500,
    })
  })

  it("keeps one frame in flight and acknowledges the stream once the viewer paints", async () => {
    const { binaries, open, socket, live } = harness()
    open()
    await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(1))

    socket().push(frame(4))
    await vi.waitFor(() => expect(binaries.length).toBe(1))

    socket().push(frame(5))
    socket().push(frame(6))
    expect(binaries.length).toBe(1)

    live.ack({ t: "browserAck", id: "a1", bytes: 19 })
    await vi.waitFor(() => expect(binaries.length).toBe(2))
    expect(decodeBrowserFrame(binaries[1] as Uint8Array)?.header.seq).toBe(2)
    const acks = socket()
      .json()
      .filter((message) => message.type === "ack")
    expect(acks).toEqual([{ type: "ack", seq: 4 }])
  })

  it("drops owner input until the daemon sees the hold, then maps it to the stream's messages", async () => {
    const agent = harness()
    agent.open()
    await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(1))
    agent.live.input({ t: "browserInput", id: "a1", events: [{ k: "down", x: 0.5, y: 0.5, b: 0 }] })
    expect(agent.socket().json()).toEqual([])

    const mine = harness({ holder: "human" })
    mine.open()
    await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(1))
    mine.socket().push({
      type: "status",
      connected: true,
      screencasting: true,
      viewportWidth: 1000,
      viewportHeight: 500,
    })
    mine.live.input({
      t: "browserInput",
      id: "a1",
      events: [
        { k: "move", x: 0.5, y: 0.25 },
        { k: "down", x: 0.5, y: 0.25, b: 0 },
        { k: "text", s: "hi" },
      ],
    })
    const sent = mine.socket().json()
    expect(sent[0]).toEqual({ type: "input_mouse", eventType: "mouseMoved", x: 500, y: 125, button: "none" })
    expect(sent[1]).toMatchObject({
      type: "input_mouse",
      eventType: "mousePressed",
      x: 500,
      y: 125,
      button: "left",
    })
    expect(sent[2]).toEqual({ type: "input_keyboard", eventType: "char", text: "hi" })
  })

  it("reports why a stream could not be opened and forgets the tab", async () => {
    const { frames, open } = harness({ stream: () => Promise.reject(new Error("no stream")) })
    open()
    await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0))
    expect(frames.at(-1)).toMatchObject({ t: "browser", id: "a1", event: { type: "error" } })
  })

  it("tells the viewer when the stream drops", async () => {
    const { frames, open, socket } = harness()
    open()
    await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(1))

    socket().emit("close")

    expect(frames.at(-1)).toMatchObject({ t: "browser", id: "a1", event: { type: "error" } })
  })
})
