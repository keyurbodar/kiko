import { assert, describe, it } from "@effect/vitest"
import type { FromDaemon, InputEvent } from "@kiko/computer/wire"
import type { Screen } from "./capture"
import { createLive } from "./daemon"
import type { Injected } from "./input"
import type { PeerModule } from "./rtc-link"
import type { Tools } from "./tools"
import type { LiveDeps, LivePolicy } from "./types"

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

function daemon(policy: LivePolicy, extra: Partial<LiveDeps> = {}, onFrame?: (frame: FromDaemon) => void) {
  const sent: FromDaemon[] = []
  const applied: InputEvent[][] = []
  const chords: [string, number][] = []
  const areas: (() => Screen | null)[] = []
  const closed = { count: 0 }
  const captured: { connections: Record<string, FakeConnection> } = { connections: {} }
  const input: Injected = {
    apply: (events) => {
      applied.push([...events])
    },
    chord: (code, mods) => {
      chords.push([code, mods])
    },
    screen: () => null,
    release: () => {},
  }
  const live = createLive({
    ...extra,
    send: (frame) => {
      sent.push(frame)
      onFrame?.(frame)
    },
    sendBinary: () => {},
    warn: () => {},
    policy: () => policy,
    rtc: fakePeer(closed, captured),
    find: () => null,
    openInput: (area) => {
      areas.push(area)
      return input
    },
  })
  const answers = () => sent.filter((frame) => frame.t === "rtc").length
  return { live, policy, applied, chords, areas, closed, answers, sent, connections: captured.connections }
}

describe("live daemon policy", () => {
  it("drops the session and applies no input once the policy turns live off", async () => {
    const run = daemon({ live: true, input: true })
    run.live.onRtc("s1", { type: "offer", sdp: OFFER })
    assert.strictEqual(run.answers(), 1)
    run.live.onControl({ holder: "human" })

    run.policy.live = false
    run.live.onInput([{ k: "text", s: "hello" }])
    await run.live.idle()
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

  it("keeps the session but applies no input when only input is turned off", async () => {
    const run = daemon({ live: true, input: true })
    run.live.onRtc("s1", { type: "offer", sdp: OFFER })
    run.live.onControl({ holder: "human" })

    run.policy.input = false
    run.live.onInput([{ k: "text", s: "hello" }])
    await run.live.idle()
    assert.deepStrictEqual(run.applied, [])

    run.policy.input = true
    run.live.onInput([{ k: "text", s: "hello" }])
    await run.live.idle()
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

  it("applies input only from the session that holds the screen", async () => {
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
    await run.live.idle()

    assert.deepStrictEqual(run.applied, [[{ k: "text", s: "mine" }]])
    run.live.close()
  })
})

const DISPLAYS = [
  { id: "left", width: 1000, height: 800, scale: 1, originX: 0, originY: 0 },
  { id: "right", width: 800, height: 600, scale: 1, originX: 1000, originY: 0 },
]

describe("text and paste", () => {
  it("types committed text through the cua type_text tool", async () => {
    const typed: unknown[] = []
    const tools: Tools = {
      has: (name) => name === "type_text",
      call: (name, args) => {
        typed.push({ name, args })
        return Promise.resolve({})
      },
    }
    const run = daemon({ live: true, input: true }, { tools: () => tools })
    run.live.onControl({ holder: "human" })

    run.live.onInput([{ k: "text", s: "こんにちは" }])
    await run.live.idle()

    assert.deepStrictEqual(typed, [{ name: "type_text", args: { text: "こんにちは" } }])
    assert.deepStrictEqual(run.applied, [])
    run.live.close()
  })

  it("types text natively when the driver has no type_text tool", async () => {
    const tools: Tools = { has: () => false, call: () => Promise.reject(new Error("no tool")) }
    const run = daemon({ live: true, input: true }, { tools: () => tools })
    run.live.onControl({ holder: "human" })

    run.live.onInput([{ k: "text", s: "plain" }])
    await run.live.idle()

    assert.deepStrictEqual(run.applied, [[{ k: "text", s: "plain" }]])
    run.live.close()
  })

  it("puts pasted text on the clipboard and then sends the paste chord", async () => {
    const writes: string[] = []
    const run = daemon(
      { live: true, input: true },
      {
        clipboard: {
          read: () => Promise.resolve(null),
          write: (text) => {
            writes.push(text)
            return Promise.resolve(true)
          },
        },
      },
    )
    run.live.onControl({ holder: "human" })

    run.live.onInput([{ k: "paste", s: "héllo\nwörld", code: "KeyV", mods: 2 }])
    await run.live.idle()

    assert.deepStrictEqual(writes, ["héllo\nwörld"])
    assert.deepStrictEqual(run.chords, [["KeyV", 2]])
    assert.deepStrictEqual(run.applied, [])
    run.live.close()
  })

  it("never pastes while the agent holds the screen", async () => {
    const writes: string[] = []
    const run = daemon(
      { live: true, input: true },
      {
        clipboard: {
          read: () => Promise.resolve(null),
          write: (text) => {
            writes.push(text)
            return Promise.resolve(true)
          },
        },
      },
    )

    run.live.onInput([{ k: "paste", s: "secret", code: "KeyV", mods: 2 }])
    await run.live.idle()

    assert.deepStrictEqual(writes, [])
    run.live.close()
  })
})

describe("the remote clipboard", () => {
  it("offers a change once while the owner holds and stops when they hand back", async () => {
    const reads: ((text: string | null) => void)[] = []
    const stopped = { count: 0 }
    const ticks: (() => void)[] = []
    const run = daemon(
      { live: true, input: true },
      {
        clipboard: {
          read: () => new Promise<string | null>((resolve) => reads.push(resolve)),
          write: () => Promise.resolve(true),
        },
        every: (_ms, tick) => {
          ticks.push(tick)
          return () => {
            stopped.count += 1
          }
        },
      },
    )
    const frames = () => run.sent.filter((frame) => frame.t === "clipboard")

    run.live.onControl({ holder: "human" })
    reads.shift()?.("before the takeover")
    await Promise.resolve()
    assert.deepStrictEqual(frames(), [])

    ticks[0]?.()
    reads.shift()?.("first")
    await Promise.resolve()
    assert.deepStrictEqual(frames(), [{ t: "clipboard", text: "first" }])

    ticks[0]?.()
    reads.shift()?.("first")
    await Promise.resolve()
    ticks[0]?.()
    reads.shift()?.("second")
    await Promise.resolve()

    assert.deepStrictEqual(frames(), [
      { t: "clipboard", text: "first" },
      { t: "clipboard", text: "second" },
    ])

    run.live.onControl({ holder: "agent" })
    assert.strictEqual(stopped.count, 1)
    ticks[0]?.()
    assert.strictEqual(reads.length, 0)
    run.live.close()
  })
})

describe("picking a display", () => {
  it("moves the captured and controlled area to the chosen display", () => {
    const run = daemon({ live: true, input: true }, { displays: () => DISPLAYS })
    const area = run.areas[0]
    assert.ok(area)
    assert.deepStrictEqual(area(), { width: 1000, height: 800, scale: 1, index: 0, originX: 0, originY: 0 })

    run.live.onScreen("right")

    assert.deepStrictEqual(area(), { width: 800, height: 600, scale: 1, index: 1, originX: 1000, originY: 0 })
    run.live.close()
  })

  it("keeps the current display when the id is not one of them", () => {
    const run = daemon({ live: true, input: true }, { displays: () => DISPLAYS })
    const area = run.areas[0]
    assert.ok(area)

    run.live.onScreen("nowhere")

    assert.strictEqual(area()?.width, 1000)
    run.live.close()
  })
})
