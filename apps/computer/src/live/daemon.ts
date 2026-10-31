import * as Schema from "effect/Schema"
import { InputEvent, type Display, type Holder, type IceServer, type RtcSignal } from "@kiko/computer/wire"
import { encodeFrame } from "@kiko/computer/frame"
import { findBinary, probeEncoders } from "./binary"
import type { AccessUnit } from "./annexb"
import { captureSize, workingEncoders, type Screen } from "./capture"
import { startH264, startMjpeg, type H264Capture, type MjpegCapture } from "./captures"
import type { Injected } from "./input"
import { createSession, type Session } from "./session"
import type { Control, Live, LiveDeps, LiveFrame } from "./types"

const RELAY_MAX_IN_FLIGHT = 1
const RELAY_MIN_ACK_MS = 250
const RELAY_FPS = 15
const RELAY_WIDTH = 1600
const RELAY_QUALITY = 65
const H264_FPS = 30
const H264_WIDTH = 2560
const GOP_LIMIT = 90

const decodeEvents = Schema.decodeUnknownOption(Schema.Array(InputEvent))

class Daemon implements Live {
  private readonly deps: LiveDeps
  private readonly input: Injected | null
  private readonly sessions = new Map<string, Session>()
  private readonly screen: Screen
  private holder: Holder = "agent"
  private holderSession: string | undefined
  private closed = false
  private h264: H264Capture | null = null
  private mjpeg: MjpegCapture | null = null
  private relay: Relay | null = null
  private gop: { unit: AccessUnit; timestamp: number }[] = []
  private encoders: readonly string[] = []

  constructor(deps: LiveDeps) {
    this.deps = deps
    const area = screenOf(deps.display)
    this.input = deps.openInput?.(area, { holder: () => this.holder, allowed: () => this.deps.policy().input }) ?? null
    this.screen = area ?? this.input?.screen() ?? { width: 1920, height: 1080 }
    this.probe()
  }

  private ffmpeg(): string | null {
    return (this.deps.find ?? ((name) => findBinary(name, this.deps.configDir)))("ffmpeg")
  }

  private probe(): void {
    const ffmpeg = this.ffmpeg()
    if (!ffmpeg) return
    void workingEncoders(ffmpeg, this.deps.encoders ?? probeEncoders(ffmpeg)).then((found) => {
      this.encoders = found
    })
  }

  onRtc(session: string, signal: RtcSignal, iceServers?: readonly IceServer[]): void {
    if (this.closed || !this.deps.policy().live || signal.type === "bye") {
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
    if (!frame.on || !this.deps.policy().live) {
      this.stopRelay()
      return
    }
    this.startRelay(frame)
  }

  onInput(events: readonly InputEvent[]): void {
    if (this.closed || !this.deps.policy().live) return
    const decoded = decodeEvents(events)
    if (decoded._tag !== "Some") return
    this.deliver(decoded.value as readonly InputEvent[])
  }

  onControl(control: Control): void {
    this.holder = control.holder
    this.holderSession = control.holder === "human" ? control.session : undefined
    if (control.holder === "agent") this.input?.release()
    this.deps.send({
      t: "held",
      holder: control.holder,
      ...(control.epoch === undefined ? {} : { epoch: control.epoch }),
    })
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
      input: (target, events) => this.deliver(events, target),
      closed: (target) => this.drop(target),
      watching: (target) => {
        this.attach()
        this.replay(target)
      },
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
  }

  private drop(id: string): void {
    const peer = this.sessions.get(id)
    if (!peer) return
    this.sessions.delete(id)
    peer.close()
    if (this.sessions.size > 0) return
    this.stopRtc()
    if (this.mjpeg) return
    this.stopWatching()
  }

  private deliver(events: readonly InputEvent[], from?: string): void {
    if (events.length === 0) return
    if (this.holder !== "human" || !this.deps.policy().input) return
    if (from !== undefined && this.holderSession !== undefined && from !== this.holderSession) return
    const input = events.filter((event) => event.k !== "cursor") as InputEvent[]
    if (input.length > 0) this.input?.apply(input)
  }

  private broadcast(events: readonly InputEvent[]): void {
    for (const peer of this.sessions.values()) peer.sendEvents(events)
  }

  private startCapture(): void {
    if (this.h264) return
    const ffmpeg = this.ffmpeg()
    if (!ffmpeg) return
    this.h264 = startH264({
      ffmpeg,
      screen: this.screen,
      fps: H264_FPS,
      maxWidth: H264_WIDTH,
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
    })
  }

  private startRelay(frame: LiveFrame): void {
    const profile = relayProfile(frame)
    if (this.relay) {
      if (sameProfile(this.relay.profile, profile)) return
      this.relay.profile = profile
      this.restartMjpeg(profile)
      return
    }
    if (this.sessions.size === 0) this.stopRtc()
    this.relay = {
      inFlight: new Map(),
      latest: null,
      seq: 0,
      ackMs: Math.max(RELAY_MIN_ACK_MS, Math.round(2000 / profile.fps)),
      profile,
    }
    this.restartMjpeg(profile)
  }

  private restartMjpeg(profile: RelayProfile): void {
    const ffmpeg = this.ffmpeg()
    if (!ffmpeg) return
    this.mjpeg?.stop()
    if (this.relay) this.relay.latest = null
    this.mjpeg = startMjpeg({
      ffmpeg,
      screen: this.screen,
      fps: profile.fps,
      maxWidth: profile.maxWidth,
      quality: profile.quality,
      handlers: {
        frame: (jpeg) => this.pushRelay(jpeg),
        failed: (reason) => {
          this.deps.warn(`live capture stopped: ${reason}`)
          this.stopWatching()
        },
      },
    })
  }

  private pushRelay(jpeg: Uint8Array): void {
    if (!this.relay) return
    this.relay.latest = jpeg
    this.flushRelay()
  }

  private flushRelay(): void {
    const relay = this.relay
    if (!relay) return
    const cutoff = Date.now() - relay.ackMs
    for (const [seq, sentAt] of relay.inFlight) if (sentAt <= cutoff) relay.inFlight.delete(seq)
    if (!relay.latest || relay.inFlight.size >= RELAY_MAX_IN_FLIGHT) return
    const image = relay.latest
    relay.latest = null
    relay.seq += 1
    relay.inFlight.set(relay.seq, Date.now())
    const size = captureSize(this.screen, relay.profile.maxWidth)
    this.deps.sendBinary(
      encodeFrame({ kind: "jpeg", width: size.width, height: size.height, seq: relay.seq, cursor: null }, image),
    )
  }

  private stopRtc(): void {
    this.gop = []
    this.h264?.stop()
    this.h264 = null
  }

  private stopCapture(): void {
    this.stopRtc()
    this.mjpeg?.stop()
    this.mjpeg = null
  }

  private stopRelay(): void {
    this.relay = null
    this.mjpeg?.stop()
    this.mjpeg = null
    if (this.sessions.size === 0) this.stopWatching()
  }

  private stopWatching(): void {
    this.stopCapture()
    this.relay = null
  }
}

export function createLive(deps: LiveDeps): Live {
  return new Daemon(deps)
}

type RelayProfile = { fps: number; maxWidth: number; quality: number }

type Relay = {
  seq: number
  inFlight: Map<number, number>
  latest: Uint8Array | null
  ackMs: number
  profile: RelayProfile
}

function relayProfile(frame: LiveFrame): RelayProfile {
  return {
    fps: clamp(frame.fps, 1, 30, RELAY_FPS),
    maxWidth: clamp(frame.maxWidth, 320, 2560, RELAY_WIDTH),
    quality: clamp(frame.quality, 10, 95, RELAY_QUALITY),
  }
}

function sameProfile(a: RelayProfile, b: RelayProfile): boolean {
  return a.fps === b.fps && a.maxWidth === b.maxWidth && a.quality === b.quality
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function screenOf(display: Display | undefined): Screen | null {
  if (!display || display.width <= 0 || display.height <= 0) return null
  return { width: display.width, height: display.height, scale: display.scale }
}
