import { assert, describe, it } from "@effect/vitest"
import type { FromDaemon, InputEvent } from "@kiko/computer/wire"
import { createLive } from "./daemon"
import type { Injected } from "./input"
import type { PeerModule } from "./rtc-link"
import type { LivePolicy } from "./types"

const OFFER = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\na=rtpmap:96 H264/90000\r\n"

function fakePeer(closed: { count: number }, captured: { connections: Record<string, FakeConnection> }) {
  class Connection {
    private describe: ((sdp: string, type: string) => void) | null = null
    private state: ((state: string) => void) | null = null
    private incoming: ((channel: FakeChannel) => void) | null = null
    constructor(name: string) {
      captured.connections[name] = this as unknown as FakeConnection
    }
    onLocalDescription(handler: (sdp: string, type: string) => void) {
      this.describe = handler
    }
    onLocalCandidate() {}
    onStateChange(handler: (state: string) => void) {
      this.state = handler
    }
    onDataChannel(handler: (channel: FakeChannel) => void) {
      this.incoming = handler
    }
    deliver(message: string) {
      const sink: { onMessage?: (message: string) => void } = {}
      this.incoming?.({
        getLabel: () => "input",
        onMessage: (handler: (message: string) => void) => {
          sink.onMessage = handler
        },
        isOpen: () => true,
        sendMessage: () => {},
        bufferedAmount: () => 0,
        close: () => {},
      })
      sink.onMessage?.(message)
    }
    addRemoteCandidate() {}
    setRemoteDescription() {
      this.describe?.("v=0", "answer")
      this.state?.("connected")
    }
    addTrack() {
      return {
        setMediaHandler() {},
        onOpen() {},
        onClosed() {},
        isOpen: () => false,
        sendMessageBinary() {},
        close() {},
      }
    }
    createDataChannel() {
      return { onOpen() {}, onClosed() {}, onMessage() {}, send() {}, close() {} }
    }
    close() {
      closed.count++
    }
  }
  class Video {
    addH264Codec() {}
    addSSRC() {}
  }
  class Config {
    timestamp = 0
  }
  class Packetizer {
    addToChain() {}
  }
  class Reporter {
    readonly kind = "reporter"
  }
  return {
    default: {
      PeerConnection: Connection,
      Video,
      RtpPacketizationConfig: Config,
      H264RtpPacketizer: Packetizer,
      RtcpSrReporter: Reporter,
    },
  } as unknown as PeerModule
}

type FakeChannel = {
  getLabel(): string
  onMessage(handler: (message: string) => void): void
  isOpen(): boolean
  sendMessage(message: string): void
  bufferedAmount(): number
  close(): void
}

type FakeConnection = { deliver(message: string): void }

function daemon(policy: LivePolicy) {
  const sent: FromDaemon[] = []
  const applied: InputEvent[][] = []
  const closed = { count: 0 }
  const captured: { connections: Record<string, FakeConnection> } = { connections: {} }
  const input: Injected = {
    apply: (events) => {
      applied.push([...events])
    },
    screen: () => null,
    release: () => {},
  }
  const live = createLive({
    send: (frame) => {
      sent.push(frame)
    },
    sendBinary: () => {},
    warn: () => {},
    policy: () => policy,
    rtc: fakePeer(closed, captured),
    find: () => null,
    openInput: () => input,
  })
  const answers = () => sent.filter((frame) => frame.t === "rtc").length
  return { live, policy, applied, closed, answers, sent, connections: captured.connections }
}

describe("live daemon policy", () => {
  it("drops the session and applies no input once the policy turns live off", () => {
    const run = daemon({ live: true, input: true })
    run.live.onRtc("s1", { type: "offer", sdp: OFFER })
    assert.strictEqual(run.answers(), 1)
    run.live.onControl({ holder: "human" })

    run.policy.live = false
    run.live.onInput([{ k: "text", s: "hello" }])
    assert.deepStrictEqual(run.applied, [])

    run.live.onRtc("s1", { type: "ice", candidate: "candidate" })
    assert.strictEqual(run.closed.count, 1)
    run.live.close()
  })

  it("answers again once the policy turns live back on", () => {
    const run = daemon({ live: true, input: true })
    run.policy.live = false
    run.live.onRtc("s1", { type: "offer", sdp: OFFER })
    assert.strictEqual(run.answers(), 0)

    run.policy.live = true
    run.live.onRtc("s1", { type: "offer", sdp: OFFER })
    assert.strictEqual(run.answers(), 1)
    run.live.close()
  })

  it("keeps the session but applies no input when only input is turned off", () => {
    const run = daemon({ live: true, input: true })
    run.live.onRtc("s1", { type: "offer", sdp: OFFER })
    run.live.onControl({ holder: "human" })

    run.policy.input = false
    run.live.onInput([{ k: "text", s: "hello" }])
    assert.deepStrictEqual(run.applied, [])

    run.policy.input = true
    run.live.onInput([{ k: "text", s: "hello" }])
    assert.deepStrictEqual(run.applied, [[{ k: "text", s: "hello" }]])
    run.live.close()
  })
})

describe("the holder", () => {
  it("acks the holder and its epoch", () => {
    const run = daemon({ live: true, input: true })

    run.live.onControl({ holder: "human", epoch: 3 })

    assert.deepStrictEqual(run.sent.at(-1), { t: "held", holder: "human", epoch: 3 })
    run.live.close()
  })

  it("applies input only from the session that holds the screen", () => {
    const run = daemon({ live: true, input: true })
    run.live.onRtc("s1", { type: "offer", sdp: OFFER })
    run.live.onRtc("s2", { type: "offer", sdp: OFFER })
    run.live.onControl({ holder: "human", session: "s1" })
    const first = run.connections["kiko-s1"]
    const second = run.connections["kiko-s2"]
    assert.ok(first)
    assert.ok(second)

    second.deliver(JSON.stringify([{ k: "text", s: "theirs" }]))
    first.deliver(JSON.stringify([{ k: "text", s: "mine" }]))

    assert.deepStrictEqual(run.applied, [[{ k: "text", s: "mine" }]])
    run.live.close()
  })
})
