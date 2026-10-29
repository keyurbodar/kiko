import type { ComputerFrame, ComputerInput, ComputerSignal } from "@kiko/protocol"
import * as Option from "effect/Option"
import { observe, owner, run, valueOf } from "../../state/runtime"
import { onUserSignal } from "../../state/user"

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

  const signal = (next: ComputerSignal) => void run(owner.commands.pcRtc, { pcId, signal: next })

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

  const stop = onUserSignal("pc.rtc", (frame) => {
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

  void run(owner.commands.pcWatch, { pcId, on: true, mode: "rtc" })
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

function startRelay(pcId: string, hooks: Hooks): { frame(frame: ComputerFrame): void; close(): void } {
  const context = hooks.canvas.getContext("2d")
  let latest: ComputerFrame | null = null
  let busy = false
  let closed = false
  let painted = -1

  function paint(bitmap: ImageBitmap, frame: ComputerFrame) {
    const { canvas } = hooks
    if (canvas.width !== frame.width || canvas.height !== frame.height) {
      canvas.width = frame.width
      canvas.height = frame.height
    }
    context?.drawImage(bitmap, 0, 0, frame.width, frame.height)
    hooks.onSize(frame.width, frame.height)
    hooks.onCursor(frame.cursor)
  }

  async function drain() {
    if (busy) return
    busy = true
    while (latest) {
      const frame = latest
      latest = null
      if (closed) break
      try {
        const blob = new Blob([Uint8Array.from(atob(frame.data), (c) => c.charCodeAt(0))], { type: frame.mime })
        const bitmap = await createImageBitmap(blob)
        if (!closed) paint(bitmap, frame)
        bitmap.close()
      } catch {}
    }
    busy = false
  }

  return {
    frame(frame) {
      if (closed || frame.seq <= painted) return
      painted = frame.seq
      latest = frame
      void drain()
    },
    close() {
      closed = true
      latest = null
    },
  }
}

export function startSession(pcId: string, hooks: Hooks): Session {
  let mode: Mode = "connecting"
  let closed = false
  let rtc: Rtc | null = null
  let relay: ReturnType<typeof startRelay> | null = null
  let stopFrames: () => void = () => {}
  let fallback: ReturnType<typeof setTimeout> | undefined

  const setMode = (next: Mode) => {
    if (closed || mode === next) return
    mode = next
    hooks.onMode(next)
  }

  const toRelay = (stop: () => void) => {
    if (closed || relay) return
    clearTimeout(fallback)
    stop()
    rtc = null
    setMode("connecting")
    relay = startRelay(pcId, hooks)
    stopFrames = observe(
      owner.computerFramesAtom(pcId),
      (result) => {
        const frame = Option.flatten(Option.fromNullishOr(valueOf(result)))
        if (Option.isNone(frame)) return
        relay?.frame(frame.value)
        void run(owner.commands.pcAck, { pcId, seq: frame.value.seq })
        setMode("relay")
      },
      { immediate: true },
    )
  }

  const connect = () => {
    if (closed || relay) return
    rtc?.close()
    setMode("connecting")
    let live = false
    const started = startRtc(pcId, hooks, {
      live: () => {
        live = true
        clearTimeout(fallback)
        if (!closed && !relay) setMode("rtc")
      },
      fail: () => toRelay(() => started.close()),
    })
    rtc = started
    fallback = setTimeout(() => {
      if (!live) toRelay(() => started.close())
    }, FALLBACK_MS)
  }

  connect()

  return {
    send(events) {
      if (rtc?.send(events)) return
      if (relay) void run(owner.commands.pcInput, { pcId, events })
    },
    close() {
      closed = true
      clearTimeout(fallback)
      rtc?.close()
      stopFrames()
      relay?.close()
      void run(owner.commands.pcWatch, { pcId, on: false })
    },
  }
}
