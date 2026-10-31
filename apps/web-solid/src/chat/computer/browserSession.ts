import { browserKey, type BrowserFeed, type BrowserSize } from "@kiko/client-runtime/state"
import type { ComputerInput } from "@kiko/protocol"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { failureMessage, observe, owner, run, valueOf } from "../../state/runtime"

export type BrowserStatus = "connecting" | "live" | "ended" | "error"

export type BrowserHooks = {
  canvas: HTMLCanvasElement
  onViewport(viewport: { width: number; height: number }): void
  onStatus(status: BrowserStatus, message?: string): void
}

export type BrowserSession = {
  send(events: readonly ComputerInput[]): void
  close(): void
}

type Frame = { data: string; mime: string; width: number; height: number }

export function startBrowser(pcId: string, tab: string, size: BrowserSize, hooks: BrowserHooks): BrowserSession {
  const key = browserKey(pcId, tab, size)
  const context = hooks.canvas.getContext("2d")
  let seen = 0
  let closed = false
  let busy = false
  let latest: Frame | null = null

  const paint = (bitmap: ImageBitmap, frame: Frame) => {
    const { canvas } = hooks
    if (canvas.width !== frame.width || canvas.height !== frame.height) {
      canvas.width = frame.width
      canvas.height = frame.height
    }
    context?.drawImage(bitmap, 0, 0, frame.width, frame.height)
  }

  const drain = async () => {
    if (busy) return
    busy = true
    while (latest) {
      const frame = latest
      latest = null
      if (closed) break
      try {
        const raw = atob(frame.data)
        const bytes = new Uint8Array(raw.length)
        for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index)
        const bitmap = await createImageBitmap(new Blob([bytes], { type: frame.mime }))
        if (!closed) {
          paint(bitmap, frame)
          void run(owner.commands.browserAck, { pcId, tab, bytes: bytes.byteLength })
        }
        bitmap.close()
      } catch {}
    }
    busy = false
  }

  const read = (feed: BrowserFeed) => {
    for (const item of feed.items) {
      if (item.seq <= seen) continue
      seen = item.seq
      const event = item.event
      if (event.type === "start") {
        hooks.onViewport({ width: event.viewportWidth, height: event.viewportHeight })
        hooks.onStatus("live")
      } else if (event.type === "frame") {
        latest = { data: event.data, mime: event.mime, width: event.width, height: event.height }
        void drain()
      } else if (event.type === "error") hooks.onStatus("error", event.message)
      else hooks.onStatus("ended")
    }
  }

  const drainFeed = (result: AsyncResult.AsyncResult<BrowserFeed, unknown>) => {
    if (closed) return
    if (AsyncResult.isFailure(result)) {
      hooks.onStatus("error", failureMessage(result.cause, "Kiko could not open this browser tab."))
      return
    }
    const feed = valueOf(result)
    if (feed) read(feed)
  }

  const stop = observe(owner.browserAtom(key), drainFeed, { immediate: true })

  return {
    send(events) {
      if (closed || events.length === 0) return
      void run(owner.commands.browserInput, { pcId, tab, events })
    },
    close() {
      closed = true
      latest = null
      stop()
    },
  }
}
