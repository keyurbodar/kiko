import { assert, describe, it } from "@effect/vitest"
import type { InputEvent } from "@kiko/computer/wire"
import type { PeerModule } from "./rtc-link"
import { createSession } from "./session"

const OFFER = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=mid:0\r\na=rtpmap:96 H264/90000\r\n"

const EVENTS = {
  signal: () => {},
  input: () => {},
  closed: () => {},
  watching: () => {},
  needKeyframe: () => {},
}

type Listener = (message: string | Buffer | ArrayBuffer) => void

function fakePeer(seen: { config?: unknown }, channel?: unknown): PeerModule {
  class Connection {
    constructor(_name: string, config: unknown) {
      seen.config = config
    }
    onLocalDescription() {}
    onLocalCandidate() {}
    onStateChange() {}
    onDataChannel(handler: (incoming: unknown) => void) {
      if (channel) handler(channel)
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
    const seen: { config?: unknown } = {}
    const session = createSession("abc", fakePeer(seen), EVENTS)

    session.answer(OFFER, [])

    assert.deepStrictEqual(seen.config, { iceServers: ["stun:stun.cloudflare.com:3478"] })
    session.close()
  })

  it("decodes data channel input and drops frames the schema rejects", () => {
    const seen: { listener?: Listener } = {}
    const received: (readonly InputEvent[])[] = []
    const channel = {
      getLabel: () => "input",
      onMessage: (listener: Listener) => {
        seen.listener = listener
      },
      isOpen: () => true,
      bufferedAmount: () => 0,
      sendMessage: () => {},
      close: () => {},
    }
    const session = createSession("abc", fakePeer({}, channel), {
      ...EVENTS,
      input: (_session, events) => received.push(events),
    })

    session.answer(OFFER, [])
    const deliver = (body: string) => seen.listener?.(body)
    deliver(JSON.stringify([{ k: "move", x: 0.5, y: 0.5 }]))
    deliver(JSON.stringify([{ k: "move", x: 1e9, y: 0.5 }]))
    deliver(JSON.stringify([{ k: "move", x: "a", y: 0.5 }]))
    deliver(JSON.stringify([{ k: "nope" }]))
    deliver(JSON.stringify({ k: "move", x: 0.5, y: 0.5 }))
    deliver("not json")

    assert.deepStrictEqual(received, [[{ k: "move", x: 0.5, y: 0.5 }]])
    session.close()
  })
})
