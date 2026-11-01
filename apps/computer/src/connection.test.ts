import { assert, describe, it, vi } from "@effect/vitest"
import type { DriverCall } from "@kiko/computer/driver"
import { PROTOCOL } from "@kiko/computer/wire"
import { type Host, runLink } from "./connection"
import type { Deadline } from "./deadline"
import type { Driver } from "./driver"

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
    driver: () => null,
    paused: () => false,
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

type Result = { t: string; id: string; ok: boolean; value?: unknown; error?: { code: string; message: string } }

function fakeDriver() {
  const calls: DriverCall[] = []
  const driver: Driver = {
    call: async (call: DriverCall, _deadline: Deadline) => {
      calls.push(call)
      return { windows: [] }
    },
    state: () => null,
    background: () => false,
    browser: () => false,
    close: () => {},
  }
  return { driver, calls }
}

const desktopOn = async () => ({
  shell: true,
  files: { allow: ["~"] },
  desktop: true,
  live: false,
  input: true,
})

async function openLink(host: Host) {
  vi.stubGlobal("WebSocket", FakeSocket)
  const link = runLink(host)
  const opening = link as unknown as { open(): Promise<void> }
  const done = opening.open()
  await vi.waitFor(() => assert.strictEqual(FakeSocket.made.length, 1))
  const socket = FakeSocket.made[0]!
  socket.open()
  void done
  return { link, socket }
}

function sendDriver(socket: FakeSocket, id: string, args: unknown) {
  socket.emit("message", { data: JSON.stringify({ t: "call", id, op: "driver", args, deadlineMs: 5_000 }) })
}

async function resultOf(socket: FakeSocket, id: string): Promise<Result> {
  await vi.waitFor(() => {
    assert.isTrue(socket.sent.some((frame) => (JSON.parse(frame as string) as Result).id === id))
  })
  return socket.sent.map((frame) => JSON.parse(frame as string) as Result).find((frame) => frame.id === id)!
}

describe("driver calls", () => {
  it("forwards a driver call to the kiko app", async () => {
    const { driver, calls } = fakeDriver()
    const { link, socket } = await openLink({ ...(await host()), driver: () => driver, policy: desktopOn })
    try {
      sendDriver(socket, "c1", { method: "windows" })

      const result = await resultOf(socket, "c1")

      assert.isTrue(result.ok)
      assert.deepStrictEqual(result.value, { windows: [] })
      assert.deepStrictEqual(calls, [{ method: "windows" }])
    } finally {
      link.stop()
      reset()
    }
  })

  it("answers busy when the owner paused the agent", async () => {
    const { driver } = fakeDriver()
    const { link, socket } = await openLink({
      ...(await host()),
      driver: () => driver,
      policy: desktopOn,
      paused: () => true,
    })
    try {
      sendDriver(socket, "c1", { method: "windows" })

      const result = await resultOf(socket, "c1")

      assert.isFalse(result.ok)
      assert.deepStrictEqual(result.error, {
        code: "busy",
        message: "the owner paused the agent from the kiko menu",
      })
    } finally {
      link.stop()
      reset()
    }
  })

  it("answers busy when the owner has control", async () => {
    const { driver } = fakeDriver()
    const { link, socket } = await openLink({
      ...(await host()),
      driver: () => driver,
      policy: desktopOn,
      holder: () => "human",
    })
    try {
      sendDriver(socket, "c1", { method: "windows" })

      const result = await resultOf(socket, "c1")

      assert.isFalse(result.ok)
      assert.strictEqual(result.error?.code, "busy")
    } finally {
      link.stop()
      reset()
    }
  })

  it("refuses driver work when the policy turns the desktop off", async () => {
    const { driver, calls } = fakeDriver()
    const { link, socket } = await openLink({
      ...(await host()),
      driver: () => driver,
      policy: async () => ({ ...(await desktopOn()), desktop: false }),
    })
    try {
      sendDriver(socket, "c1", { method: "windows" })

      const result = await resultOf(socket, "c1")

      assert.isFalse(result.ok)
      assert.strictEqual(result.error?.code, "denied")
      assert.strictEqual(calls.length, 0)
    } finally {
      link.stop()
      reset()
    }
  })

  it("refuses driver work when the kiko app is not there", async () => {
    const { link, socket } = await openLink({ ...(await host()), policy: desktopOn })
    try {
      sendDriver(socket, "c1", { method: "windows" })

      const result = await resultOf(socket, "c1")

      assert.isFalse(result.ok)
      assert.strictEqual(result.error?.code, "unsupported")
    } finally {
      link.stop()
      reset()
    }
  })
})
