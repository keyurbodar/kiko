import type { IceServer, InputEvent, RtcSignal } from "@kiko/computer/wire"
import type { AccessUnit } from "./annexb"
import { rtcConfig, videoMid, videoPayloadType, type PeerModule } from "./rtc-link"

const INPUT_CHANNEL = "input"
const H264_CLOCK = 90_000
const CONNECT_TIMEOUT_MS = 30_000
const KEYFRAME_DELAY_MS = 250
const CHANNEL_BACKLOG = 256 * 1024

export type SessionEvents = {
  signal(session: string, signal: RtcSignal): void
  input(session: string, events: readonly InputEvent[]): void
  closed(session: string): void
  watching(session: string): void
  needKeyframe(): void
}

export type Session = {
  readonly id: string
  answer(offer: string, iceServers: readonly IceServer[]): void
  candidate(signal: RtcSignal): void
  send(unit: AccessUnit, timestamp: number): void
  sendEvents(events: readonly InputEvent[]): void
  close(): void
}

type Peer = InstanceType<PeerModule["default"]["PeerConnection"]>
type Track = ReturnType<Peer["addTrack"]>
type Channel = ReturnType<Peer["createDataChannel"]>

export function createSession(id: string, rtc: PeerModule, events: SessionEvents): Session {
  let peer: Peer | null = new rtc.default.PeerConnection(`kiko-${id}`, rtcConfig([]))
  let track: Track | null = null
  let channel: Channel | null = null
  let config: { timestamp: number } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let keyframeTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  const queued: RtcSignal[] = []

  const close = (): void => {
    if (closed) return
    closed = true
    clear(timer)
    clear(keyframeTimer)
    timer = null
    keyframeTimer = null
    try {
      channel?.close()
    } catch {}
    try {
      track?.close()
    } catch {}
    try {
      peer?.close()
    } catch {}
    events.closed(id)
  }

  const candidate = (signal: RtcSignal): void => {
    if (closed || !signal.candidate) return
    if (!peer) {
      queued.push(signal)
      return
    }
    try {
      peer.addRemoteCandidate(signal.candidate, signal.mid ?? "0")
    } catch {}
  }

  const watch = (connection: Peer): void => {
    connection.onLocalDescription((sdp, type) => {
      if (type === "answer" || type === "offer") events.signal(id, { type, sdp })
    })
    connection.onLocalCandidate((out, mid) => {
      if (closed) return
      events.signal(id, { type: "ice", candidate: out, mid })
    })
    connection.onStateChange((state) => {
      if (state === "connected") {
        clear(timer)
        timer = null
      }
      if (state === "failed" || state === "closed") close()
    })
    connection.onDataChannel((incoming) => {
      if (incoming.getLabel() !== INPUT_CHANNEL) return
      channel = incoming
      incoming.onMessage((message) => {
        if (closed) return
        const parsed = parseEvents(message)
        if (parsed) events.input(id, parsed)
      })
    })
  }

  const publish = (offer: string, connection: Peer, iceServers: readonly IceServer[]): void => {
    if (closed) return
    timer = setTimeout(close, CONNECT_TIMEOUT_MS)
    void iceServers
    const payloadType = videoPayloadType(offer)
    const video = new rtc.default.Video(videoMid(offer), "SendOnly")
    video.addH264Codec(payloadType)
    const ssrc = Math.floor(Math.random() * 0x7fff_ffff) + 1
    video.addSSRC(ssrc, `kiko-${id}`, "kiko", "screen")
    const out = connection.addTrack(video)
    const rtp = new rtc.default.RtpPacketizationConfig(ssrc, `kiko-${id}`, payloadType, H264_CLOCK)
    const packetizer = new rtc.default.H264RtpPacketizer("StartSequence", rtp, 1200)
    packetizer.addToChain(new rtc.default.RtcpSrReporter(rtp))
    out.setMediaHandler(packetizer)
    out.onOpen(() => {
      clear(timer)
      timer = null
      events.watching(id)
      keyframeTimer = setTimeout(() => events.needKeyframe(), KEYFRAME_DELAY_MS)
    })
    out.onClosed(close)
    track = out
    config = rtp
    connection.setRemoteDescription(offer, "offer")
    for (const signal of queued.splice(0)) candidate(signal)
  }

  return {
    id,
    answer(offer, iceServers) {
      if (closed || track || !peer) return
      void iceServers
      watch(peer)
      publish(offer, peer, iceServers)
    },
    candidate,
    send(unit, timestamp) {
      if (closed || !track || !config) return
      if (!track.isOpen()) return
      try {
        config.timestamp = timestamp
        track.sendMessageBinary(Buffer.from(unit.data))
      } catch {
        close()
      }
    },
    sendEvents(list) {
      if (closed || !channel || !channel.isOpen()) return
      if (channel.bufferedAmount() > CHANNEL_BACKLOG) return
      try {
        channel.sendMessage(JSON.stringify(list))
      } catch {}
    },
    close,
  }
}

function parseEvents(message: string | Buffer | ArrayBuffer): readonly InputEvent[] | null {
  try {
    const text = typeof message === "string" ? message : Buffer.from(message as ArrayBuffer).toString("utf8")
    const value: unknown = JSON.parse(text)
    if (!Array.isArray(value)) return null
    return value as readonly InputEvent[]
  } catch {
    return null
  }
}

function clear(handle: ReturnType<typeof setTimeout> | null): void {
  if (handle) clearTimeout(handle)
}
