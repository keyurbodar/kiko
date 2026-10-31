import type { ComputerInput, ComputerSignal } from "@kiko/protocol"
import { liveSocket, owner, run } from "../../state/runtime"
import { onUserSignal } from "../../state/user"

export type Mode = "connecting" | "rtc" | "relay" | "stalled"
export type Cursor = { x: number; y: number } | null
export type Display = { width: number; height: number; scale: number }

export type Hooks = {
  video: HTMLVideoElement
  canvas: HTMLCanvasElement
  display: Display | null
  onMode(mode: Mode): void
  onSize(width: number, height: number): void
  onCursor(cursor: Cursor): void
}

export type Session = { send(events: readonly ComputerInput[]): void; close(): void }

const STUN = "stun:stun.cloudflare.com:3478"
const ICE_WAIT_MS = 350
const PAIR_WAIT_MS = 1_500
const RELAY_SILENT_MS = 15_000
const FRAME_HEADER = 14
const MOTION_BYTES = 220_000
const CALM_BYTES = 60_000
const PROFILE_GAP_MS = 2_000
const RELAY_FPS = 15
const RELAY_QUALITY = 70
const MOTION_QUALITY = 50

type Profile = { fps: number; maxWidth: number; quality: number }

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

async function paired(peer: RTCPeerConnection): Promise<boolean> {
  const report = await peer.getStats().catch(() => null)
  if (!report) return false
  let found = false
  report.forEach((entry) => {
    const stat = entry as { type?: string; state?: string; nominated?: boolean }
    if (stat.type === "candidate-pair" && (stat.state === "succeeded" || stat.nominated === true)) found = true
  })
  return found
}

function startRtc(pcId: string, hooks: Hooks, on: RtcEvents): Rtc {
  const { video } = hooks
  let peer: RTCPeerConnection | null = null
  let channel: RTCDataChannel | null = null
  let ice: RTCIceServer[] = [{ urls: STUN }]
  let remoteSet = false
  let closed = false
  let begun = false
  let live = false
  let wait: ReturnType<typeof setTimeout> | undefined
  let pairWait: ReturnType<typeof setTimeout> | undefined
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

  const failed = (state: string) => state === "failed" || state === "disconnected"

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
        if (closed) return
        live = true
        clearTimeout(pairWait)
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
      if (failed(next.connectionState)) on.fail()
    })
    next.addEventListener("iceconnectionstatechange", () => {
      if (failed(next.iceConnectionState)) on.fail()
    })
    pairWait = setTimeout(() => {
      if (live || closed) return
      void paired(next).then((ok) => {
        if (!ok && !closed && !live) on.fail()
      })
    }, PAIR_WAIT_MS)
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
      clearTimeout(pairWait)
      if (begun) signal({ type: "bye" })
      channel?.close()
      peer?.close()
      video.removeEventListener("resize", resize)
      video.srcObject = null
    },
  }
}

function initialProfile(display: Display | null): Profile {
  const physical = display ? Math.round(display.width * (display.scale > 0 ? display.scale : 1)) : 0
  return { fps: RELAY_FPS, maxWidth: Math.min(2560, physical || 1600), quality: RELAY_QUALITY }
}

function frameHeader(raw: ArrayBuffer): { width: number; height: number; seq: number } | null {
  if (raw.byteLength <= FRAME_HEADER) return null
  const view = new DataView(raw)
  if (view.getUint8(0) !== 1) return null
  return { width: view.getUint16(2, true), height: view.getUint16(4, true), seq: view.getUint32(6, true) }
}

function startRelay(pcId: string, hooks: Hooks, on: { frame(): void; fail(): void }) {
  const context = hooks.canvas.getContext("2d")
  const address = liveSocket(pcId)
  const socket = new WebSocket(address.url, address.protocols)
  socket.binaryType = "arraybuffer"
  const initial = initialProfile(hooks.display)
  let profile = initial
  let latest: ArrayBuffer | null = null
  let busy = false
  let closed = false
  let painted = -1
  let bytes = 0
  let changedAt = 0

  const request = (next: Profile) => {
    profile = next
    changedAt = performance.now()
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: "live", ...next }))
  }

  const adapt = (size: number) => {
    bytes = bytes ? bytes * 0.8 + size * 0.2 : size
    if (performance.now() - changedAt < PROFILE_GAP_MS) return
    if (bytes > MOTION_BYTES && profile.maxWidth > 640) {
      request({ fps: profile.fps, maxWidth: Math.round(initial.maxWidth / 2), quality: MOTION_QUALITY })
    } else if (bytes < CALM_BYTES && profile.maxWidth < initial.maxWidth) {
      request(initial)
    }
  }

  async function drain() {
    if (busy) return
    busy = true
    while (latest) {
      const raw = latest
      latest = null
      if (closed) break
      const header = frameHeader(raw)
      if (!header || header.seq <= painted) continue
      painted = header.seq
      try {
        const bitmap = await createImageBitmap(new Blob([raw.slice(FRAME_HEADER)], { type: "image/jpeg" }))
        if (!closed) {
          const { canvas } = hooks
          if (canvas.width !== header.width || canvas.height !== header.height) {
            canvas.width = header.width
            canvas.height = header.height
          }
          context?.drawImage(bitmap, 0, 0, header.width, header.height)
          hooks.onSize(header.width, header.height)
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: "ack", seq: header.seq }))
          on.frame()
          adapt(raw.byteLength)
        }
        bitmap.close()
      } catch {}
    }
    busy = false
  }

  socket.addEventListener("open", () => {
    if (!closed) socket.send(JSON.stringify({ t: "live", ...profile }))
  })
  socket.addEventListener("message", (event) => {
    if (closed || !(event.data instanceof ArrayBuffer)) return
    latest = event.data
    void drain()
  })
  socket.addEventListener("close", () => {
    if (!closed) on.fail()
  })
  socket.addEventListener("error", () => {
    if (!closed) on.fail()
  })

  return {
    close() {
      closed = true
      latest = null
      socket.close()
    },
  }
}

export function startSession(pcId: string, hooks: Hooks): Session {
  let mode: Mode = "connecting"
  let closed = false
  let rtc: Rtc | null = null
  let relay: ReturnType<typeof startRelay> | null = null
  let silent: ReturnType<typeof setTimeout> | undefined

  const setMode = (next: Mode) => {
    if (closed || mode === next) return
    mode = next
    hooks.onMode(next)
  }

  const stopRelay = () => {
    clearTimeout(silent)
    relay?.close()
    relay = null
  }

  const openRelay = () => {
    if (closed || relay) return
    relay = startRelay(pcId, hooks, {
      frame: () => {
        clearTimeout(silent)
        if (mode !== "rtc") setMode("relay")
      },
      fail: () => {
        if (closed) return
        stopRelay()
        if (mode !== "rtc") setMode("stalled")
      },
    })
    silent = setTimeout(() => {
      if (!closed && mode !== "rtc") setMode("stalled")
    }, RELAY_SILENT_MS)
  }

  const stopRtc = () => {
    rtc?.close()
    rtc = null
  }

  openRelay()
  rtc = startRtc(pcId, hooks, {
    live: () => {
      if (closed) return
      stopRelay()
      setMode("rtc")
    },
    fail: () => {
      stopRtc()
      if (closed) return
      openRelay()
      if (mode === "rtc") setMode("connecting")
    },
  })

  return {
    send(events) {
      if (rtc?.send(events)) return
      void run(owner.commands.pcInput, { pcId, events })
    },
    close() {
      closed = true
      clearTimeout(silent)
      stopRtc()
      stopRelay()
      void run(owner.commands.pcWatch, { pcId, on: false })
    },
  }
}
