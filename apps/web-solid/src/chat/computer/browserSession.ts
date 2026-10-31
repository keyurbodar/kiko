import { decodeBrowserFrame } from "@kiko/computer/frame"
import type { BrowserEvent, ComputerInput } from "@kiko/protocol"
import { liveSocket, owner, run } from "../../state/runtime"

export type BrowserStatus = "connecting" | "live" | "ended" | "error"

export type BrowserHooks = {
  canvas: HTMLCanvasElement
  onStatus(status: BrowserStatus, message?: string): void
  onSize(width: number, height: number): void
}

export type BrowserSession = {
  send(events: readonly ComputerInput[]): void
  close(): void
}

export type BrowserSize = { maxWidth: number; maxHeight: number }

const QUALITY = 70

export function startBrowser(pcId: string, tab: string, size: BrowserSize, hooks: BrowserHooks): BrowserSession {
  const address = liveSocket(pcId)
  const socket = new WebSocket(address.url, address.protocols)
  socket.binaryType = "arraybuffer"
  const context = hooks.canvas.getContext("2d")
  const id = crypto.randomUUID()
  let latest: ArrayBuffer | null = null
  let busy = false
  let closed = false
  let painted = 0

  const attach = () => {
    if (closed || socket.readyState !== WebSocket.OPEN) return
    socket.send(
      JSON.stringify({
        t: "browser",
        on: true,
        id,
        tab,
        maxWidth: size.maxWidth,
        maxHeight: size.maxHeight,
        quality: QUALITY,
      }),
    )
  }

  const read = (data: string) => {
    let message: { t?: string; event?: BrowserEvent }
    try {
      message = JSON.parse(data) as { t?: string; event?: BrowserEvent }
    } catch {
      return
    }
    if (message.t !== "browser" || !message.event) return
    const event = message.event
    if (event.type === "start") hooks.onStatus("live")
    else if (event.type === "error") hooks.onStatus("error", event.message)
    else if (event.type === "end") hooks.onStatus("ended")
  }

  async function drain() {
    if (busy) return
    busy = true
    while (latest) {
      const raw = latest
      latest = null
      if (closed) break
      const frame = decodeBrowserFrame(new Uint8Array(raw))
      if (!frame || frame.header.seq <= painted) continue
      painted = frame.header.seq
      try {
        const bitmap = await createImageBitmap(new Blob([frame.image], { type: "image/jpeg" }))
        if (!closed) {
          const { canvas } = hooks
          if (canvas.width !== frame.header.width || canvas.height !== frame.header.height) {
            canvas.width = frame.header.width
            canvas.height = frame.header.height
          }
          context?.drawImage(bitmap, 0, 0, frame.header.width, frame.header.height)
          hooks.onSize(frame.header.viewportWidth, frame.header.viewportHeight)
          if (socket.readyState === WebSocket.OPEN)
            socket.send(JSON.stringify({ t: "browserAck", id, bytes: frame.image.byteLength }))
        }
        bitmap.close()
      } catch {}
    }
    busy = false
  }

  socket.addEventListener("open", attach)
  socket.addEventListener("message", (event) => {
    if (closed) return
    if (event.data instanceof ArrayBuffer) {
      latest = event.data
      void drain()
      return
    }
    if (typeof event.data === "string") read(event.data)
  })
  socket.addEventListener("close", () => {
    if (!closed) hooks.onStatus("ended")
  })
  socket.addEventListener("error", () => {
    if (!closed) hooks.onStatus("error")
  })

  return {
    send(events) {
      if (closed || events.length === 0) return
      void run(owner.commands.browserInput, { pcId, tab, events })
    },
    close() {
      closed = true
      latest = null
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: "browser", on: false, id }))
      socket.close()
    },
  }
}
