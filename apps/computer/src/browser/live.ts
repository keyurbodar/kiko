import { encodeBrowserFrame } from "@kiko/computer/frame"
import type { FromDaemon, Holder, ToDaemon } from "@kiko/computer/wire"
import { openCdp, type Cdp } from "./cdp"
import { applyInput, createInputState, type InputState, type Viewport } from "./input"

const VIEW_WINDOW = 256 * 1024
const MAX_DPR = 2
const DEFAULT_QUALITY = 65
const MIN_WIDTH = 320
const MAX_WIDTH = 4096

type Open = Extract<ToDaemon, { t: "browser" }>
type Input = Extract<ToDaemon, { t: "browserInput" }>
type Ack = Extract<ToDaemon, { t: "browserAck" }>
type Event = Extract<FromDaemon, { t: "browser" }>["event"]

type Metadata = { deviceWidth?: unknown; deviceHeight?: unknown }

type Attach = {
  id: string
  tab: string
  session: string
  cdp: Cdp
  viewport: Viewport
  state: InputState
  seq: number
  pending: number
  latest: Uint8Array | null
  meta: Metadata
  stop: () => void
}

export type BrowserLiveDeps = {
  cdpUrl: () => Promise<string>
  send(frame: FromDaemon): void
  sendBinary(bytes: Uint8Array<ArrayBuffer>): void
  holder: () => Holder
  warn(message: string): void
  connect?: (url: string) => Promise<Cdp>
}

export type BrowserLive = {
  open(frame: Open): void
  input(frame: Input): void
  ack(frame: Ack): void
  close(): void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

function viewportOf(metrics: unknown): Viewport {
  const source = record(metrics)
  const view = record(source.cssVisualViewport ?? source.cssLayoutViewport)
  const width = typeof view.clientWidth === "number" ? view.clientWidth : 0
  const height = typeof view.clientHeight === "number" ? view.clientHeight : 0
  return width > 0 && height > 0 ? { width, height } : { width: 1280, height: 800 }
}

export function createBrowserLive(deps: BrowserLiveDeps): BrowserLive {
  const attaches = new Map<string, Attach>()
  let connection: Promise<Cdp> | null = null
  let connected: Cdp | null = null
  let closed = false

  const connect = (): Promise<Cdp> => {
    if (!connection) {
      connection = deps
        .cdpUrl()
        .then((url) => (deps.connect ?? openCdp)(url))
        .then((next) => {
          connected = next
          return next
        })
      connection.catch(() => {
        connection = null
      })
    }
    return connection
  }

  const event = (id: string, next: Event) => deps.send({ t: "browser", id, event: next })

  const detach = (id: string) => {
    const attach = attaches.get(id)
    if (!attach) return false
    attaches.delete(id)
    attach.stop()
    return true
  }

  const release = () => {
    if (attaches.size > 0) return
    connected?.close()
    connected = null
    connection = null
  }

  const stop = (id: string) => {
    if (!detach(id)) return
    event(id, { type: "end" })
    release()
  }

  const paint = (attach: Attach, image: Uint8Array) => {
    attach.seq += 1
    attach.pending += image.byteLength
    const width = typeof attach.meta.deviceWidth === "number" ? attach.meta.deviceWidth : attach.viewport.width
    const height = typeof attach.meta.deviceHeight === "number" ? attach.meta.deviceHeight : attach.viewport.height
    deps.sendBinary(
      encodeBrowserFrame(
        {
          id: attach.id,
          tab: attach.tab,
          seq: attach.seq,
          width: Math.round(width),
          height: Math.round(height),
          viewportWidth: Math.round(attach.viewport.width),
          viewportHeight: Math.round(attach.viewport.height),
        },
        image,
      ),
    )
  }

  const receive = (attach: Attach, params: Record<string, unknown>) => {
    const frameId = typeof params.sessionId === "number" ? params.sessionId : undefined
    if (frameId !== undefined)
      void attach.cdp.send("Page.screencastFrameAck", { sessionId: frameId }, attach.session).catch(() => {})
    if (typeof params.data !== "string" || !params.data) return
    const image = new Uint8Array(Buffer.from(params.data, "base64"))
    if (image.byteLength === 0) return
    attach.meta = record(params.metadata)
    if (attach.pending >= VIEW_WINDOW) {
      attach.latest = image
      return
    }
    paint(attach, image)
  }

  const start = async (id: string, tab: string, frame: Open) => {
    const cdp = await connect()
    if (closed) return
    const attached = record(await cdp.send("Target.attachToTarget", { targetId: tab, flatten: true }))
    const session = typeof attached.sessionId === "string" ? attached.sessionId : ""
    if (!session) throw new Error("the browser would not open a live session for that tab")
    if (closed) {
      void cdp.send("Target.detachFromTarget", { sessionId: session }).catch(() => {})
      return
    }
    const viewport = viewportOf(await cdp.send("Page.getLayoutMetrics", {}, session))
    const scale = Math.min(MAX_DPR, Math.max(0.25, (frame.maxWidth ?? viewport.width) / viewport.width))
    const attach: Attach = {
      id,
      tab,
      session,
      cdp,
      viewport,
      state: createInputState(),
      seq: 0,
      pending: 0,
      latest: null,
      meta: {},
      stop: cdp.on("Page.screencastFrame", (params, from) => {
        if (from === session) receive(attach, params)
      }),
    }
    attaches.set(id, attach)
    cdp.onClose(() => {
      if (!detach(id)) return
      release()
      event(id, { type: "error", message: "the browser's devtools socket closed" })
    })
    event(id, {
      type: "start",
      tab,
      width: Math.round(viewport.width),
      height: Math.round(viewport.height),
      viewportWidth: Math.round(viewport.width),
      viewportHeight: Math.round(viewport.height),
    })
    await cdp.send(
      "Page.startScreencast",
      {
        format: "jpeg",
        quality: clamp(frame.quality, 20, 90, DEFAULT_QUALITY),
        maxWidth: clamp(viewport.width * scale, MIN_WIDTH, MAX_WIDTH, viewport.width),
        maxHeight: Math.max(1, Math.round(viewport.height * scale)),
        everyNthFrame: 1,
      },
      session,
    )
  }

  const fail = (id: string, error: unknown) => {
    if (closed) return
    detach(id)
    release()
    const message = `the browser live view could not start: ${messageOf(error)}`
    deps.warn(message)
    event(id, { type: "error", message })
  }

  return {
    open(frame) {
      detach(frame.id)
      if (!frame.on || closed) {
        release()
        return
      }
      if (!frame.tab) {
        event(frame.id, { type: "error", message: "pick a browser tab to watch" })
        return
      }
      void start(frame.id, frame.tab, frame).catch((error: unknown) => fail(frame.id, error))
    },
    input(frame) {
      if (closed || deps.holder() !== "human") return
      const attach = attaches.get(frame.id)
      if (!attach) return
      applyInput(frame.events, attach.viewport, attach.state, (method, params) => {
        void attach.cdp
          .send(method, params, attach.session)
          .catch((error: unknown) => deps.warn(`browser input failed: ${messageOf(error)}`))
      })
    },
    ack(frame) {
      const attach = attaches.get(frame.id)
      if (!attach) return
      attach.pending = Math.max(0, attach.pending - frame.bytes)
      if (attach.pending >= VIEW_WINDOW || !attach.latest) return
      const image = attach.latest
      attach.latest = null
      paint(attach, image)
    },
    close() {
      closed = true
      for (const id of [...attaches.keys()]) stop(id)
      connected?.close()
      connected = null
      connection = null
    },
  }
}
