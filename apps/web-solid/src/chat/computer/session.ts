import { decodeFrame, type FrameHeader } from "@kiko/computer/frame"
import type { ComputerInput, ComputerSignal } from "@kiko/protocol"
import { userChannel } from "../../sync/socket"

export type Mode = "connecting" | "rtc" | "relay"
export type Cursor = { x: number; y: number } | null

export type Hooks = {
  video: HTMLVideoElement
  canvas: HTMLCanvasElement
  onMode(mode: Mode): void
  onSize(width: number, height: number): void
  onCursor(cursor: Cursor): void
}

export type Session = { send(events: readonly ComputerInput[]): void; close(): void }

const STUN = "stun:stun.cloudflare.com:3478"
const FALLBACK_MS = 5_000
const ICE_WAIT_MS = 350

type Rtc = { send(events: readonly ComputerInput[]): boolean; close(): void }
type RtcEvents = { live(): void; fail(): void }

function agentCursor(item: unknown): Cursor {
  if (typeof item !== "object" || item === null) return null
  const { k, who, x, y } = item as Record<string, unknown>
  return k === "cursor" && who === "agent" && typeof x === "number" && typeof y === "number" ? { x, y } : null
}

function readCursors(data: unknown, onCursor: (cursor: Cursor) => void): void {
  if (typeof data !== "string") return
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return
  }
  for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
    const cursor = agentCursor(item)
    if (cursor) onCursor(cursor)
  }
}

function lowLatency(receiver: RTCRtpReceiver): void {
  for (const key of ["playoutDelayHint", "jitterBufferTarget"]) {
    try {
      Reflect.set(receiver, key, 0)
    } catch {}
  }
}

function onFirstFrame(video: HTMLVideoElement, live: () => void): void {
  if (typeof video.requestVideoFrameCallback === "function") {
    video.requestVideoFrameCallback(live)
    return
  }
  video.addEventListener("playing", live, { once: true })
}

function startRtc(pcId: string, hooks: Hooks, on: RtcEvents): Rtc {
  const { video } = hooks
  let peer: RTCPeerConnection | null = null
  let channel: RTCDataChannel | null = null
  let ice: RTCIceServer[] = [{ urls: STUN }]
  let remoteSet = false
  let closed = false
  let begun = false
  let wait: ReturnType<typeof setTimeout> | undefined
  const queued: RTCIceCandidateInit[] = []

  const signal = (next: ComputerSignal) => userChannel.send({ t: "pc.rtc", pcId, signal: next })

  const resize = () => {
    if (video.videoWidth) hooks.onSize(video.videoWidth, video.videoHeight)
  }

  async function answer(sdp: string) {
    if (!peer) return
    await peer.setRemoteDescription({ type: "answer", sdp })
    remoteSet = true
    for (const candidate of queued.splice(0)) await peer.addIceCandidate(candidate)
  }

  async function remote(next: ComputerSignal) {
    if (next.type === "bye") return on.fail()
    if (next.type === "answer" && next.sdp) return answer(next.sdp)
    if (next.type !== "ice" || !next.candidate) return
    const candidate = { candidate: next.candidate, sdpMid: next.mid ?? null }
    if (remoteSet && peer) await peer.addIceCandidate(candidate)
    else queued.push(candidate)
  }

  async function begin() {
    if (begun || closed) return
    begun = true
    const next = new RTCPeerConnection({ iceServers: ice, bundlePolicy: "max-bundle" })
    peer = next
    lowLatency(next.addTransceiver("video", { direction: "recvonly" }).receiver)
    channel = next.createDataChannel("input", { ordered: true })
    channel.addEventListener("message", (event) => readCursors(event.data, hooks.onCursor))
    next.addEventListener("track", (event) => {
      video.srcObject = event.streams[0] ?? new MediaStream([event.track])
      void video.play().catch(() => {})
      onFirstFrame(video, () => {
        resize()
        on.live()
      })
    })
    video.addEventListener("resize", resize)
    next.addEventListener("icecandidate", (event) => {
      if (!event.candidate) return
      signal({
        type: "ice",
        candidate: event.candidate.candidate,
        ...(event.candidate.sdpMid ? { mid: event.candidate.sdpMid } : {}),
      })
    })
    next.addEventListener("connectionstatechange", () => {
      if (next.connectionState === "failed") on.fail()
    })
    const offer = await next.createOffer()
    signal({ type: "offer", ...(offer.sdp ? { sdp: offer.sdp } : {}) })
    await next.setLocalDescription(offer)
  }

  const begins = () => void begin().catch(on.fail)

  const stop = userChannel.on("pc.rtc", (frame) => {
    if (frame.pcId !== pcId || closed) return
    if (frame.iceServers?.length) {
      ice = frame.iceServers.map((server) => ({ ...server, urls: server.urls as string | string[] }))
      if (!begun) {
        clearTimeout(wait)
        begins()
      }
    }
    if (frame.signal.type === "ice" && !frame.signal.candidate && !begun) {
      clearTimeout(wait)
      begins()
      return
    }
    void remote(frame.signal).catch(on.fail)
  })

  userChannel.send({ t: "pc.watch", pcId, on: true, mode: "rtc" })
  wait = setTimeout(begins, ICE_WAIT_MS)

  return {
    send(events) {
      if (channel?.readyState !== "open") return false
      channel.send(JSON.stringify(events))
      return true
    },
    close() {
      closed = true
      stop()
      clearTimeout(wait)
      if (begun) signal({ type: "bye" })
      channel?.close()
      peer?.close()
      video.removeEventListener("resize", resize)
      video.srcObject = null
    },
  }
}

function frameOf(data: ArrayBuffer, pcId: string): ReturnType<typeof decodeFrame> {
  const bytes = new Uint8Array(data)
  const length = bytes[0] ?? 0
  if (new TextDecoder().decode(bytes.subarray(1, 1 + length)) !== pcId) return null
  return decodeFrame(bytes.subarray(1 + length))
}

function startRelay(pcId: string, hooks: Hooks, live: () => void): () => void {
  const context = hooks.canvas.getContext("2d")
  let latest: { header: FrameHeader; image: Uint8Array } | null = null
  let busy = false
  let closed = false

  function paint(bitmap: ImageBitmap, header: FrameHeader) {
    const { canvas } = hooks
    if (canvas.width !== header.width || canvas.height !== header.height) {
      canvas.width = header.width
      canvas.height = header.height
    }
    context?.drawImage(bitmap, 0, 0, header.width, header.height)
    hooks.onSize(header.width, header.height)
    hooks.onCursor(header.cursor)
    live()
  }

  async function drain() {
    if (busy) return
    busy = true
    while (latest) {
      const { header, image } = latest
      latest = null
      if (closed) break
      const type = header.kind === "webp" ? "image/webp" : "image/jpeg"
      try {
        const bitmap = await createImageBitmap(new Blob([image as Uint8Array<ArrayBuffer>], { type }))
        if (!closed) paint(bitmap, header)
        bitmap.close()
      } catch {}
      userChannel.send({ t: "pc.ack", pcId, seq: header.seq })
    }
    busy = false
  }

  const stop = userChannel.onBinary((data) => {
    const frame = frameOf(data, pcId)
    if (!frame) return
    latest = frame
    void drain()
  })
  userChannel.send({ t: "pc.watch", pcId, on: true, mode: "relay" })

  return () => {
    closed = true
    stop()
  }
}

export function startSession(pcId: string, hooks: Hooks): Session {
  let mode: Mode = "connecting"
  let closed = false
  let rtc: Rtc | null = null
  let stopRelay: (() => void) | null = null
  let fallback: ReturnType<typeof setTimeout> | undefined

  const setMode = (next: Mode) => {
    if (closed || mode === next) return
    mode = next
    hooks.onMode(next)
  }

  const toRelay = () => {
    if (closed || stopRelay) return
    clearTimeout(fallback)
    rtc?.close()
    rtc = null
    setMode("connecting")
    stopRelay = startRelay(pcId, hooks, () => setMode("relay"))
  }

  rtc = startRtc(pcId, hooks, {
    live: () => {
      if (stopRelay) return
      clearTimeout(fallback)
      setMode("rtc")
    },
    fail: toRelay,
  })
  fallback = setTimeout(toRelay, FALLBACK_MS)

  return {
    send(events) {
      if (rtc?.send(events)) return
      if (stopRelay) userChannel.send({ t: "pc.input", pcId, events })
    },
    close() {
      closed = true
      clearTimeout(fallback)
      rtc?.close()
      stopRelay?.()
      userChannel.send({ t: "pc.watch", pcId, on: false })
    },
  }
}
