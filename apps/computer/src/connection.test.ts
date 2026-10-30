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
  FakeSocket.made = []
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
})
