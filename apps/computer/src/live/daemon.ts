import * as Schema from "effect/Schema"
import { InputEvent, type Display, type Holder, type IceServer, type RtcSignal } from "@kiko/computer/wire"
import { encodeFrame } from "@kiko/computer/frame"
import { findBinary, probeEncoders } from "./binary"
import type { AccessUnit } from "./annexb"
import { workingEncoders, type Screen } from "./capture"
import { startH264, startMjpeg, type H264Capture, type MjpegCapture } from "./captures"
import { createInput, type Injected } from "./input"
import { createSession, type Session } from "./session"
import type { Live, LiveDeps, LiveFrame } from "./types"

const CURSOR_INTERVAL_MS = Math.round(1000 / 30)
const CURSOR_EPSILON = 0.0008
const RELAY_MAX_IN_FLIGHT = 2
const RELAY_FPS = 8
const RELAY_WIDTH = 1280
const RELAY_QUALITY = 60
const H264_FPS = 30
const H264_WIDTH = 1920
const GOP_LIMIT = 90

const decodeEvents = Schema.decodeUnknownOption(Schema.Array(InputEvent))

class Daemon implements Live {
  private readonly deps: LiveDeps
  private readonly input: Injected | null
  private readonly sessions = new Map<string, Session>()
  private readonly screen: Screen
  private holder: Holder = "agent"
  private closed = false
  private cursorTimer: ReturnType<typeof setInterval> | null = null
  private cursorAt: { x: number; y: number } | null = null
  private h264: H264Capture | null = null
  private mjpeg: MjpegCapture | null = null
  private relay: Relay | null = null
  private gop: { unit: AccessUnit; timestamp: number }[] = []
  private encoders: readonly string[] = []

  constructor(deps: LiveDeps) {
    this.deps = deps
    const area = screenOf(deps.display)
    this.input = createInput(area, { holder: () => this.holder, allowed: () => this.deps.policy.input })
    this.screen = area ?? this.input?.screen() ?? { width: 1920, height: 1080 }
    this.probe()
  }

  private probe(): void {
    const ffmpeg = findBinary("ffmpeg", this.deps.configDir)
    if (!ffmpeg) return
    void workingEncoders(ffmpeg, this.deps.encoders ?? probeEncoders(ffmpeg)).then((found) => {
      this.encoders = found
    })
  }

  onRtc(session: string, signal: RtcSignal, iceServers?: readonly IceServer[]): void {
    if (this.closed || !this.deps.policy.live || signal.type === "bye") {
      this.drop(session)
      return
    }
    if (signal.type === "offer" && signal.sdp) {
      this.startCapture()
      this.session(session).answer(signal.sdp, iceServers ?? [])
    } else if (signal.type === "ice") this.session(session).candidate(signal)
  }

  onLive(frame: LiveFrame): void {
    if (this.closed) return
    if (!frame.on || !this.deps.policy.live) {
      this.stopWatching()
      return
    }
    this.startRelay(frame)
  }

  onInput(events: readonly InputEvent[]): void {
    if (this.closed || !this.deps.policy.live) return
    const decoded = decodeEvents(events)
    if (decoded._tag !== "Some") return
    this.deliver(decoded.value as readonly InputEvent[])
  }

  onControl(holder: Holder): void {
    if (this.holder === holder) return
    this.holder = holder
    if (holder === "agent") {
      this.input?.release()
      this.broadcast([{ k: "cursor", who: "real", x: 0, y: 0 }])
    }
  }

  onAck(seq: number): void {
    const relay = this.relay
    if (!relay) return
    relay.inFlight.delete(seq)
    this.flushRelay()
  }

  agentCursor(x: number, y: number): void {
    if (this.closed) return
    this.broadcast([{ k: "cursor", who: "agent", x, y }])
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const id of this.sessions.keys()) this.drop(id)
    this.stopWatching()
    this.input?.release()
  }

  private session(id: string): Session {
    const existing = this.sessions.get(id)
    if (existing) return existing
    const created = createSession(id, this.deps.rtc, {
      signal: (target, signal) => this.deps.send({ t: "rtc", session: target, signal }),
      input: (_target, events) => this.deliver(events),
      closed: (target) => this.drop(target),
      watching: (target) => {
        this.attach()
        this.replay(target)
      },
      needKeyframe: () => this.requestKeyframe(),
    })
    this.sessions.set(id, created)
    return created
  }

  private remember(unit: AccessUnit, timestamp: number): void {
    if (unit.key) this.gop = []
    if (this.gop.length < GOP_LIMIT) this.gop.push({ unit, timestamp })
  }

  private replay(id: string): void {
    const peer = this.sessions.get(id)
    if (!peer || this.gop[0]?.unit.key !== true) return
    for (const { unit, timestamp } of this.gop) peer.send(unit, timestamp)
  }

  private attach(): void {
    this.startCapture()
    this.startCursor()
  }

  private drop(id: string): void {
    const peer = this.sessions.get(id)
    if (!peer) return
    this.sessions.delete(id)
    peer.close()
    if (this.sessions.size > 0 || this.mjpeg) return
    this.stopWatching()
  }

  private deliver(events: readonly InputEvent[]): void {
    if (events.length === 0) return
    if (this.holder !== "human" || !this.deps.policy.input) return
    const input = events.filter((event) => event.k !== "cursor") as InputEvent[]
    if (input.length > 0) this.input?.apply(input)
  }

  private broadcast(events: readonly InputEvent[]): void {
    for (const peer of this.sessions.values()) peer.sendEvents(events)
  }

  private startCapture(): void {
    if (this.h264 || this.mjpeg) return
    const ffmpeg = findBinary("ffmpeg", this.deps.configDir)
    if (!ffmpeg) return
    this.h264 = startH264({
      ffmpeg,
      screen: this.screen,
      fps: H264_FPS,
      maxWidth: Math.min(H264_WIDTH, Math.round(this.screen.width) || H264_WIDTH),
      encoders: this.encoders,
      handlers: {
        unit: (unit, timestamp) => {
          this.remember(unit, timestamp)
          for (const peer of this.sessions.values()) peer.send(unit, timestamp)
        },
        failed: (reason) => {
          this.deps.warn(`live capture stopped: ${reason}`)
          this.stopWatching()
        },
      },
      onRestart: () => this.requestKeyframe(),
    })
  }

  private startRelay(frame: LiveFrame): void {
    this.stopCapture()
    const ffmpeg = findBinary("ffmpeg", this.deps.configDir)
    if (!ffmpeg) return
    this.relay = { inFlight: new Set(), latest: null, seq: 0 }
    this.mjpeg = startMjpeg({
      ffmpeg,
      screen: this.screen,
      fps: clamp(frame.fps, 1, 15, RELAY_FPS),
      maxWidth: clamp(frame.maxWidth, 320, 1920, RELAY_WIDTH),
      quality: clamp(frame.quality, 10, 95, RELAY_QUALITY),
      handlers: {
        frame: (jpeg) => this.pushRelay(jpeg),
        failed: (reason) => {
          this.deps.warn(`live capture stopped: ${reason}`)
          this.stopWatching()
        },
      },
    })
    this.startCursor()
  }

  private pushRelay(jpeg: Uint8Array): void {
    if (!this.relay) return
    this.relay.latest = jpeg
    this.flushRelay()
  }

  private flushRelay(): void {
    const relay = this.relay
    if (!relay || !relay.latest || relay.inFlight.size >= RELAY_MAX_IN_FLIGHT) return
    const image = relay.latest
    relay.latest = null
    relay.seq += 1
    relay.inFlight.add(relay.seq)
    this.deps.sendBinary(
      encodeFrame(
        {
          kind: "jpeg",
          width: Math.round(this.screen.width),
          height: Math.round(this.screen.height),
          seq: relay.seq,
          cursor: this.input?.cursor() ?? null,
        },
        image,
      ),
    )
  }

  private startCursor(): void {
    if (this.cursorTimer) return
    this.cursorTimer = setInterval(() => this.publishCursor(), CURSOR_INTERVAL_MS)
  }

  private publishCursor(): void {
    if (this.sessions.size === 0) return
    const at = this.input?.cursor()
    if (!at) return
    const previous = this.cursorAt
    if (previous && Math.abs(previous.x - at.x) < CURSOR_EPSILON && Math.abs(previous.y - at.y) < CURSOR_EPSILON) return
    this.cursorAt = at
    this.broadcast([{ k: "cursor", who: "real", x: at.x, y: at.y }])
  }

  private requestKeyframe(): void {
    this.h264?.requestKeyframe()
  }

  private stopCapture(): void {
    this.gop = []
    this.h264?.stop()
    this.h264 = null
    this.mjpeg?.stop()
    this.mjpeg = null
  }

  private stopWatching(): void {
    this.stopCapture()
    this.relay = null
    this.stopCursor()
  }

  private stopCursor(): void {
    if (this.cursorTimer) clearInterval(this.cursorTimer)
    this.cursorTimer = null
    this.cursorAt = null
  }
}

export function createLive(deps: LiveDeps): Live {
  return new Daemon(deps)
}

type Relay = {
  seq: number
  inFlight: Set<number>
  latest: Uint8Array | null
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function screenOf(display: Display | undefined): Screen | null {
  if (!display || display.width <= 0 || display.height <= 0) return null
  return { width: display.width, height: display.height }
}
