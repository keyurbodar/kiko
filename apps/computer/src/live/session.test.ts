import { assert, describe, it } from "@effect/vitest"
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

function fakePeer(seen: { config?: unknown }): PeerModule {
  class Connection {
    constructor(_name: string, config: unknown) {
      seen.config = config
    }
    onLocalDescription() {}
    onLocalCandidate() {}
    onStateChange() {}
    onDataChannel() {}
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
})
