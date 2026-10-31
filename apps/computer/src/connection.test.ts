import { assert, describe, it, vi } from "@effect/vitest"
import { PROTOCOL } from "@kiko/computer/wire"
import { type Host, runLink } from "./connection"

type Event = { code?: number; reason?: string; data?: unknown }
type Listener = (event: Event) => void

class FakeSocket {
  static made: FakeSocket[] = []
  static OPEN = 1
  static CLOSED = 3
  readyState = 0
  sent: unknown[] = []
  closed: { code: number; reason: string } | null = null
  private listeners = new Map<string, Listener[]>()

  constructor(readonly url: string) {
    FakeSocket.made.push(this)
  }

  addEventListener(type: string, listener: Listener) {
    const set = this.listeners.get(type) ?? []
    set.push(listener)
    this.listeners.set(type, set)
  }

  send(data: unknown) {
    this.sent.push(data)
  }

  close(code: number, reason: string) {
    if (this.readyState === FakeSocket.CLOSED) return
    this.closed = { code, reason }
    this.readyState = FakeSocket.CLOSED
  }

  open() {
    this.readyState = FakeSocket.OPEN
    this.emit("open", {})
  }

  emit(type: string, event: Event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

async function host(): Promise<Host> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair
  return {
    endpoint: { url: "https://kiko.example", userId: "owner", pcId: "pc-1", protocol: PROTOCOL },
    key: await crypto.subtle.exportKey("jwk", pair.privateKey),
    hello: () => "{}",
    policy: async () => ({ shell: true, files: { allow: ["~"] }, desktop: false, live: false, input: false }),
    desktop: () => null,
    live: { rtc() {}, live() {}, input() {}, control() {}, ack() {} },
    holder: () => "agent",
    log: { info() {}, warn() {}, error() {} },
  }
}

function reset() {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  FakeSocket.made = []
}

const WELCOME = JSON.stringify({ t: "welcome", id: "1", name: "kiko" })

async function nextSocket(count: number): Promise<FakeSocket> {
  await vi.waitFor(() => assert.strictEqual(FakeSocket.made.length, count))
  return FakeSocket.made[count - 1]!
}

function recordWaits(): number[] {
  const waits: number[] = []
  vi.stubGlobal("Bun", {
    sleep: (ms: number) => {
      waits.push(ms)
      return Promise.resolve()
    },
  })
  vi.spyOn(Math, "random").mockReturnValue(1)
  return waits
}

async function welcomeAndDrop(count: number): Promise<void> {
  const socket = await nextSocket(count)
  socket.open()
  socket.emit("message", { data: WELCOME })
  socket.emit("close", { code: 1006 })
}

describe("daemon connect", () => {
  it("gives up on a socket that never opens", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    vi.stubGlobal("WebSocket", FakeSocket)
    try {
      const link = runLink(await host()) as unknown as { open(): Promise<void> }
      const opened = link.open()
      await vi.waitFor(() => assert.strictEqual(FakeSocket.made.length, 1))
      await vi.advanceTimersByTimeAsync(20_000)

      await opened
      assert.deepStrictEqual(FakeSocket.made[0]?.closed, { code: 4000, reason: "connect timed out" })
    } finally {
      reset()
    }
  })

  it("drops a socket that stops answering pings and reconnects", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("WebSocket", FakeSocket)
    vi.stubGlobal("Bun", { sleep: () => Promise.resolve() })
    try {
      const link = runLink(await host())
      void link.loop()
      await vi.waitFor(() => assert.strictEqual(FakeSocket.made.length, 1))
      const first = FakeSocket.made[0]!
      first.open()

      await vi.advanceTimersByTimeAsync(60_000)

      assert.deepStrictEqual(first.closed, { code: 4000, reason: "no pong" })
      await vi.waitFor(() => assert.strictEqual(FakeSocket.made.length, 2))
      link.stop()
      await vi.advanceTimersByTimeAsync(20_000)
    } finally {
      reset()
    }
  })

  it("keeps the new socket when an old one closes late", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] })
    vi.stubGlobal("WebSocket", FakeSocket)
    try {
      const link = runLink(await host())
      const opening = link as unknown as { open(): Promise<void> }
      const first = opening.open()
      await vi.waitFor(() => assert.strictEqual(FakeSocket.made.length, 1))
      const older = FakeSocket.made[0]!
      older.open()

      void opening.open()
      await vi.waitFor(() => assert.strictEqual(FakeSocket.made.length, 2))
      const newer = FakeSocket.made[1]!
      newer.open()
      const before = newer.sent.length

      older.emit("close", { code: 1006 })
      await first
      link.binary(new Uint8Array([1]))

      assert.strictEqual(newer.sent.length, before + 1)
      assert.strictEqual(older.sent.length, 1)
    } finally {
      reset()
    }
  })

  it("backs off when a worker welcomes and then drops", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("WebSocket", FakeSocket)
    const waits = recordWaits()
    try {
      const link = runLink(await host())
      void link.loop()
      await welcomeAndDrop(1)
      await welcomeAndDrop(2)
      await vi.waitFor(() => assert.strictEqual(waits.length, 2))

      assert.deepStrictEqual(waits, [1000, 2000])
      await nextSocket(3)
      link.stop()
      await vi.advanceTimersByTimeAsync(20_000)
    } finally {
      reset()
    }
  })

  it("resets the backoff after a socket stays up", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("WebSocket", FakeSocket)
    const waits = recordWaits()
    try {
      const link = runLink(await host())
      void link.loop()
      await welcomeAndDrop(1)
      await welcomeAndDrop(2)

      const stable = await nextSocket(3)
      stable.open()
      stable.emit("message", { data: WELCOME })
      await vi.advanceTimersByTimeAsync(20_000)
      stable.emit("close", { code: 1006 })

      await welcomeAndDrop(4)
      await vi.waitFor(() => assert.strictEqual(waits.length, 4))

      assert.deepStrictEqual(waits, [1000, 2000, 1000, 1000])
      await nextSocket(5)
      link.stop()
      await vi.advanceTimersByTimeAsync(20_000)
    } finally {
      reset()
    }
  })
})
