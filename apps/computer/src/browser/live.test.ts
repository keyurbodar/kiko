import { decodeBrowserFrame } from "@kiko/computer/frame"
import type { FromDaemon, ToDaemon } from "@kiko/computer/wire"
import { describe, expect, it, vi } from "vitest"
import type { Cdp } from "./cdp"
import { createBrowserLive } from "./live"

type Sent = { method: string; params: Record<string, unknown>; sessionId?: string }

function fakeCdp(metrics = { cssVisualViewport: { clientWidth: 1000, clientHeight: 500 } }) {
  const sent: Sent[] = []
  const handlers = new Map<string, (params: Record<string, unknown>, sessionId?: string) => void>()
  const closes: (() => void)[] = []
  let gone = false
  const cdp: Cdp = {
    send: (method, params = {}, sessionId) => {
      sent.push({ method, params, ...(sessionId ? { sessionId } : {}) })
      if (method === "Target.attachToTarget") return Promise.resolve({ sessionId: "S1" })
      if (method === "Page.getLayoutMetrics") return Promise.resolve(metrics)
      return Promise.resolve({})
    },
    on: (method, handler) => {
      handlers.set(method, handler)
      return () => handlers.delete(method)
    },
    onClose: (handler) => closes.push(handler),
    close: () => {
      gone = true
    },
  }
  return {
    cdp,
    sent,
    gone: () => gone,
    emit: (method: string, params: Record<string, unknown>, sessionId = "S1") =>
      handlers.get(method)?.(params, sessionId),
    close: () => {
      for (const handler of closes) handler()
    },
  }
}

function image(size: number): string {
  return Buffer.from(new Uint8Array(size).fill(7)).toString("base64")
}

function harness(options: { holder?: "agent" | "human"; cdp?: ReturnType<typeof fakeCdp> } = {}) {
  const cdp = options.cdp ?? fakeCdp()
  const frames: FromDaemon[] = []
  const binaries: Uint8Array<ArrayBuffer>[] = []
  let connects = 0
  const live = createBrowserLive({
    cdpUrl: () => Promise.resolve("ws://browser/devtools"),
    send: (frame) => frames.push(frame),
    sendBinary: (bytes) => binaries.push(bytes),
    holder: () => options.holder ?? "agent",
    warn: () => {},
    connect: () => {
      connects += 1
      return Promise.resolve(cdp.cdp)
    },
  })
  const open = (frame: Partial<Extract<ToDaemon, { t: "browser" }>>) =>
    live.open({ t: "browser", on: true, id: "a1", tab: "T1", ...frame })
  return { live, cdp, frames, binaries, open, connects: () => connects }
}

describe("browser live", () => {
  it("opens one screencast per viewer and costs nothing until then", async () => {
    const { cdp, frames, open, connects, live } = harness()

    expect(connects()).toBe(0)

    open({ maxWidth: 4000 })

    await vi.waitFor(() => expect(cdp.sent.some((call) => call.method === "Page.startScreencast")).toBe(true))
    expect(cdp.sent.find((call) => call.method === "Target.attachToTarget")?.params).toEqual({
      targetId: "T1",
      flatten: true,
    })
    const start = cdp.sent.find((call) => call.method === "Page.startScreencast")
    expect(start?.sessionId).toBe("S1")
    expect(start?.params).toMatchObject({ format: "jpeg", everyNthFrame: 1, maxWidth: 2000, maxHeight: 1000 })
    expect(frames[0]).toEqual({
      t: "browser",
      id: "a1",
      event: { type: "start", tab: "T1", width: 1000, height: 500, viewportWidth: 1000, viewportHeight: 500 },
    })

    const before = frames.length
    live.open({ t: "browser", on: false, id: "a1" })
    expect(cdp.gone()).toBe(true)
    expect(frames.length).toBe(before)
  })

  it("sends a frame as one binary header plus jpeg and acks the browser", async () => {
    const { cdp, binaries, open } = harness()
    open({})
    await vi.waitFor(() => expect(cdp.sent.some((call) => call.method === "Page.startScreencast")).toBe(true))

    cdp.emit("Page.screencastFrame", {
      data: image(2048),
      metadata: { deviceWidth: 1000, deviceHeight: 500 },
      sessionId: 9,
    })

    await vi.waitFor(() => expect(binaries.length).toBe(1))
    const decoded = decodeBrowserFrame(binaries[0] as Uint8Array)
    expect(decoded?.header).toEqual({
      id: "a1",
      tab: "T1",
      seq: 1,
      width: 1000,
      height: 500,
      viewportWidth: 1000,
      viewportHeight: 500,
    })
    expect(decoded?.image.byteLength).toBe(2048)
    expect(cdp.sent.find((call) => call.method === "Page.screencastFrameAck")?.params).toEqual({ sessionId: 9 })
  })

  it("keeps one frame waiting and paints the newest once the viewer acks", async () => {
    const { cdp, binaries, open, live } = harness()
    open({})
    await vi.waitFor(() => expect(cdp.sent.some((call) => call.method === "Page.startScreencast")).toBe(true))

    cdp.emit("Page.screencastFrame", { data: image(300_000), metadata: {}, sessionId: 1 })
    cdp.emit("Page.screencastFrame", { data: image(60_000), metadata: {}, sessionId: 2 })
    cdp.emit("Page.screencastFrame", { data: image(20_000), metadata: {}, sessionId: 3 })
    await vi.waitFor(() => expect(binaries.length).toBe(1))

    live.ack({ t: "browserAck", id: "a1", bytes: 300_000 })
    await vi.waitFor(() => expect(binaries.length).toBe(2))
    expect(decodeBrowserFrame(binaries[1] as Uint8Array)?.image.byteLength).toBe(20_000)
    expect(decodeBrowserFrame(binaries[1] as Uint8Array)?.header.seq).toBe(2)
  })

  it("drops input from the owner until the daemon sees the hold", async () => {
    const agent = harness()
    agent.open({})
    await vi.waitFor(() => expect(agent.cdp.sent.some((call) => call.method === "Page.startScreencast")).toBe(true))

    agent.live.input({ t: "browserInput", id: "a1", events: [{ k: "down", x: 0.5, y: 0.5, b: 0 }] })
    expect(agent.cdp.sent.some((call) => call.method === "Input.dispatchMouseEvent")).toBe(false)

    const mine = harness({ holder: "human" })
    mine.open({})
    await vi.waitFor(() => expect(mine.cdp.sent.some((call) => call.method === "Page.startScreencast")).toBe(true))
    mine.live.input({
      t: "browserInput",
      id: "a1",
      events: [
        { k: "move", x: 0.5, y: 0.25 },
        { k: "text", s: "hi" },
      ],
    })
    const calls = mine.cdp.sent.filter((call) => call.method.startsWith("Input."))
    expect(calls.map((call) => call.method)).toEqual(["Input.dispatchMouseEvent", "Input.insertText"])
    expect(calls[0]?.params).toMatchObject({ type: "mouseMoved", x: 500, y: 125 })
    expect(calls[0]?.sessionId).toBe("S1")
  })

  it("reports why a tab could not be opened and forgets it", async () => {
    const cdp = fakeCdp()
    const broken: Cdp = { ...cdp.cdp, send: () => Promise.reject(new Error("no such target")) }
    const frames: FromDaemon[] = []
    const live = createBrowserLive({
      cdpUrl: () => Promise.resolve("ws://browser/devtools"),
      send: (frame) => frames.push(frame),
      sendBinary: () => {},
      holder: () => "agent",
      warn: () => {},
      connect: () => Promise.resolve(broken),
    })

    live.open({ t: "browser", on: true, id: "a2", tab: "T9" })

    await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0))
    expect(frames.at(-1)).toMatchObject({
      t: "browser",
      id: "a2",
      event: { type: "error" },
    })
  })
})
