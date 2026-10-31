import { afterEach, assert, describe, it } from "@effect/vitest"
import type { InputEvent } from "@kiko/computer/wire"
import type { PeerModule } from "./rtc-link"
import { createSession, type Session } from "./session"

const OFFER = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\na=rtpmap:96 H264/90000\r\n"

const EVENTS = {
  signal: () => {},
  input: () => {},
  closed: () => {},
  watching: () => {},
  needKeyframe: () => {},
}

type Seen = { config?: unknown; dataChannel?: (channel: FakeChannel) => void }

class FakeChannel {
  private listener: ((message: unknown) => void) | null = null

  getLabel(): string {
    return "input"
  }

  onMessage(listener: (message: unknown) => void): void {
    this.listener = listener
  }

  isOpen(): boolean {
    return true
  }

  bufferedAmount(): number {
    return 0
  }

  sendMessage(): void {}

  close(): void {}

  deliver(message: unknown): void {
    this.listener?.(message)
  }
}

function fakePeer(seen: Seen): PeerModule {
  class Connection {
    constructor(_name: string, config: unknown) {
      seen.config = config
    }
    onLocalDescription() {}
    onLocalCandidate() {}
    onStateChange() {}
    onDataChannel(handler: (channel: FakeChannel) => void) {
      seen.dataChannel = handler
    }
    addRemoteCandidate() {}
    setRemoteDescription() {}
    close() {}
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

describe("webrtc session", () => {
  it("builds the peer with the ice servers the worker minted", () => {
    const seen: { config?: unknown } = {}
    const session = createSession("abc", fakePeer(seen), EVENTS)

    session.answer(OFFER, [
      { urls: "stun:stun.cloudflare.com:3478" },
      { urls: "turn:turn.example.com:3478?transport=udp", username: "u", credential: "p" },
    ])

    assert.deepStrictEqual(seen.config, {
      iceServers: [
        "stun:stun.cloudflare.com:3478",
        { hostname: "turn.example.com", port: 3478, username: "u", password: "p", relayType: "TurnUdp" },
      ],
    })
    session.close()
  })

  it("still offers STUN when the worker sent none", () => {
    const seen: Seen = {}
    const session = createSession("abc", fakePeer(seen), EVENTS)

    session.answer(OFFER, [])

    assert.deepStrictEqual(seen.config, { iceServers: ["stun:stun.cloudflare.com:3478"] })
    session.close()
  })
})

describe("input over the data channel", () => {
  let opened: Session | null = null

  afterEach(() => {
    opened?.close()
    opened = null
  })

  function open(): { channel: FakeChannel; inputs: (readonly InputEvent[])[] } {
    const seen: Seen = {}
    const inputs: (readonly InputEvent[])[] = []
    const session = createSession("abc", fakePeer(seen), { ...EVENTS, input: (_id, events) => inputs.push(events) })
    opened = session
    session.answer(OFFER, [])
    const channel = new FakeChannel()
    seen.dataChannel?.(channel)
    return { channel, inputs }
  }

  it("passes a well formed batch through", () => {
    const { channel, inputs } = open()
    const batch: InputEvent[] = [{ k: "wheel", x: 0.5, y: 0.5, dx: 0, dy: 12 }]

    channel.deliver(JSON.stringify(batch))

    assert.deepStrictEqual(inputs, [batch])
  })

  it("drops a batch with a number that is not a number", () => {
    const { channel, inputs } = open()

    channel.deliver(JSON.stringify([{ k: "wheel", x: 0.5, y: 0.5, dx: 0, dy: "NaN" }]))

    assert.deepStrictEqual(inputs, [])
  })

  it("drops a batch that is not a list of events", () => {
    const { channel, inputs } = open()

    channel.deliver(JSON.stringify({ k: "move", x: 0.5, y: 0.5 }))

    assert.deepStrictEqual(inputs, [])
  })

  it("drops a batch that is not JSON at all", () => {
    const { channel, inputs } = open()

    channel.deliver("not json")

    assert.deepStrictEqual(inputs, [])
  })
})
