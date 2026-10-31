import { encodeBrowserFrame } from "@kiko/computer/frame"
import type { FromDaemon, Holder, ToDaemon } from "@kiko/computer/wire"
import { applyInput, createInputState, type InputState, type Viewport } from "./input"
import { jpegSize } from "./jpeg"

const MAX_FPS = 30
const DEFAULT_VIEWPORT: Viewport = { width: 1280, height: 800 }

type Open = Extract<ToDaemon, { t: "browser" }>
type Input = Extract<ToDaemon, { t: "browserInput" }>
type Ack = Extract<ToDaemon, { t: "browserAck" }>
type Event = Extract<FromDaemon, { t: "browser" }>["event"]

export type StreamSocket = {
  readyState: number
  send(data: string): void
  close(): void
  addEventListener(type: string, handler: (event: { data?: unknown }) => void): void
}

const OPEN = 1

type Frame = { image: Uint8Array; seq: number; width: number; height: number }

type Attach = {
  id: string
  tab: string
  socket: StreamSocket
  viewport: Viewport
  state: InputState
  seq: number
  awaiting: { seq: number; bytes: number } | null
  latest: Frame | null
  started: boolean
}

type BrowserLiveDeps = {
  stream: (tab: string) => Promise<string>
  send(frame: FromDaemon): void
  sendBinary(bytes: Uint8Array<ArrayBuffer>): void
  holder: () => Holder
  warn(message: string): void
  open?: (url: string) => StreamSocket
}

type BrowserLive = {
  open(frame: Open): void
  input(frame: Input): void
  ack(frame: Ack): void
  close(): void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function createBrowserLive(deps: BrowserLiveDeps): BrowserLive {
  const attaches = new Map<string, Attach>()
  let closed = false

  const event = (id: string, next: Event) => deps.send({ t: "browser", id, event: next })

  const detach = (id: string) => {
    const attach = attaches.get(id)
    if (!attach) return false
    attaches.delete(id)
    try {
      attach.socket.close()
    } catch {}
    return true
  }

  const paint = (attach: Attach, frame: Frame) => {
    attach.seq += 1
    attach.awaiting = { seq: frame.seq, bytes: frame.image.byteLength }
    deps.sendBinary(
      encodeBrowserFrame(
        {
          id: attach.id,
          tab: attach.tab,
          seq: attach.seq,
          width: frame.width,
          height: frame.height,
          viewportWidth: Math.round(attach.viewport.width),
          viewportHeight: Math.round(attach.viewport.height),
        },
        frame.image,
      ),
    )
  }

  const start = (attach: Attach) => {
    if (attach.started) return
    attach.started = true
    event(attach.id, {
      type: "start",
      tab: attach.tab,
      width: Math.round(attach.viewport.width),
      height: Math.round(attach.viewport.height),
      viewportWidth: Math.round(attach.viewport.width),
      viewportHeight: Math.round(attach.viewport.height),
    })
  }

  const frameMessage = (attach: Attach, message: Record<string, unknown>) => {
    const data = typeof message.data === "string" ? message.data : ""
    const seq = number(message.seq)
    if (!data || seq === undefined) return
    const image = new Uint8Array(Buffer.from(data, "base64"))
    if (image.byteLength === 0) return
    const meta = record(message.metadata)
    const width = number(meta.deviceWidth)
    const height = number(meta.deviceHeight)
    if (width && height) attach.viewport = { width, height }
    const size = jpegSize(image) ?? { width: width ?? 0, height: height ?? 0 }
    if (size.width <= 0 || size.height <= 0) return
    start(attach)
    const frame = { image, seq, width: size.width, height: size.height }
    if (attach.awaiting) {
      attach.latest = frame
      return
    }
    paint(attach, frame)
  }

  const statusMessage = (attach: Attach, message: Record<string, unknown>) => {
    const width = number(message.viewportWidth)
    const height = number(message.viewportHeight)
    if (width && height) attach.viewport = { width, height }
    if (message.connected === false) {
      event(attach.id, { type: "error", message: "the browser is not connected" })
      return
    }
    if (message.screencasting === true) start(attach)
  }

  const receive = (attach: Attach, data: unknown) => {
    if (typeof data !== "string") return
    let message: Record<string, unknown>
    try {
      message = record(JSON.parse(data))
    } catch {
      return
    }
    if (message.type === "frame") frameMessage(attach, message)
    else if (message.type === "status") statusMessage(attach, message)
  }

  const fail = (id: string, error: unknown) => {
    if (closed) return
    detach(id)
    const message = `the browser live view could not start: ${messageOf(error)}`
    deps.warn(message)
    event(id, { type: "error", message })
  }

  const run = async (id: string, tab: string) => {
    const url = await deps.stream(tab)
    if (closed) return
    const socket = (deps.open ?? ((target: string) => new WebSocket(target) as unknown as StreamSocket))(url)
    const attach: Attach = {
      id,
      tab,
      socket,
      viewport: DEFAULT_VIEWPORT,
      state: createInputState(),
      seq: 0,
      awaiting: null,
      latest: null,
      started: false,
    }
    attaches.set(id, attach)
    socket.addEventListener("open", () => {
      if (attaches.get(id) !== attach) return
      try {
        socket.send(JSON.stringify({ type: "config", pacing: "ack", maxFps: MAX_FPS }))
      } catch {}
    })
    socket.addEventListener("message", (event) => {
      if (attaches.get(id) === attach) receive(attach, event.data)
    })
    socket.addEventListener("close", () => {
      if (!detach(id)) return
      event(id, { type: "error", message: "the browser stream closed" })
    })
    socket.addEventListener("error", () => {
      if (!detach(id)) return
      event(id, { type: "error", message: "the browser stream failed" })
    })
  }

  return {
    open(frame) {
      detach(frame.id)
      if (!frame.on || closed) return
      if (!frame.tab) {
        event(frame.id, { type: "error", message: "pick a browser tab to watch" })
        return
      }
      void run(frame.id, frame.tab).catch((error: unknown) => fail(frame.id, error))
    },
    input(frame) {
      if (closed || deps.holder() !== "human") return
      const attach = attaches.get(frame.id)
      if (!attach || attach.socket.readyState !== OPEN) return
      applyInput(frame.events, attach.viewport, attach.state, (message) => {
        try {
          attach.socket.send(JSON.stringify(message))
        } catch (error) {
          deps.warn(`browser input failed: ${messageOf(error)}`)
        }
      })
    },
    ack(frame) {
      const attach = attaches.get(frame.id)
      if (!attach || !attach.awaiting) return
      const awaiting = attach.awaiting
      attach.awaiting = null
      try {
        attach.socket.send(JSON.stringify({ type: "ack", seq: awaiting.seq }))
      } catch {}
      if (!attach.latest) return
      const latest = attach.latest
      attach.latest = null
      paint(attach, latest)
    },
    close() {
      closed = true
      for (const id of [...attaches.keys()]) detach(id)
    },
  }
}
