import { assert, describe, it, vi } from "@effect/vitest"
import type { DriverCall } from "@kiko/computer/driver"
import { PROTOCOL } from "@kiko/computer/wire"
import { type Host, runLink } from "./connection"
import type { Deadline } from "./deadline"
import type { Driver } from "./driver"
import { Fail } from "./log"
import { TerminalManager } from "./terminal/manager"

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
    driver: () => null,
    terminal: () => null,
    terminals: { open() {}, input() {}, resize() {}, ack() {}, close() {} },
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

function sendBrowserSteps(socket: FakeSocket, id: string, args: unknown) {
  socket.emit("message", { data: JSON.stringify({ t: "call", id, op: "browser_steps", args, deadlineMs: 5_000 }) })
}

const TAB = {
  id: "t-1",
  browser: "chrome",
  window_id: 1,
  index: 0,
  active: true,
  title: "Inbox",
  url: "https://mail.example/",
}

const PAGE = { tab: TAB, nodes: [], outline: '[2] link "Compose"' }

function fakeBrowser(reject?: (call: DriverCall) => void) {
  const calls: DriverCall[] = []
  const driver: Driver = {
    call: async (call: DriverCall) => {
      calls.push(call)
      reject?.(call)
      return call.method === "browser.read" ? PAGE : { route: "trusted" }
    },
    state: () => null,
    background: () => false,
    browser: () => true,
    close: () => {},
  }
  return { driver, calls }
}

function sendTerminal(socket: FakeSocket, id: string, op: string, args: unknown) {
  socket.emit("message", { data: JSON.stringify({ t: "call", id, op, args, deadlineMs: 5_000 }) })
}

function fakeTerminals() {
  const writes: string[] = []
  const manager = new TerminalManager({
    spawn: () => ({
      pid: 7,
      write: (data) => writes.push(data),
      resize: () => {},
      kill: () => {},
      close: () => {},
      exited: new Promise(() => {}),
    }),
    screen: () => ({ write: (_text, done) => done?.(), text: () => "", resize: () => {}, dispose: () => {} }),
  })
  return { manager, writes }
}

async function resultOf(socket: FakeSocket, id: string): Promise<Result> {
  await vi.waitFor(() => {
    assert.isTrue(socket.sent.some((frame) => (JSON.parse(frame as string) as Result).id === id))
  })
  return socket.sent.map((frame) => JSON.parse(frame as string) as Result).find((frame) => frame.id === id)!
}

describe("terminal calls", () => {
  it("opens a terminal through the manager", async () => {
    const { manager } = fakeTerminals()
    const { link, socket } = await openLink({ ...(await host()), terminal: () => manager })
    try {
      sendTerminal(socket, "c1", "terminal_open", { name: "repl" })

      const result = await resultOf(socket, "c1")

      assert.isTrue(result.ok)
      assert.strictEqual((result.value as { name: string }).name, "repl")
    } finally {
      manager.closeAll()
      link.stop()
      reset()
    }
  })

  it("types into a terminal and reports the bytes", async () => {
    const { manager, writes } = fakeTerminals()
    const { link, socket } = await openLink({ ...(await host()), terminal: () => manager })
    try {
      const target = manager.open({ name: "repl" })
      sendTerminal(socket, "c1", "terminal_send", { id: target.id, text: "ls", keys: ["enter"] })

      const result = await resultOf(socket, "c1")

      assert.isTrue(result.ok)
      assert.deepStrictEqual((result.value as { bytes: number }).bytes, 3)
      assert.deepStrictEqual(writes, ["ls\r"])
    } finally {
      manager.closeAll()
      link.stop()
      reset()
    }
  })

  it("denies terminals when policy turns shell off", async () => {
    const { manager } = fakeTerminals()
    const { link, socket } = await openLink({
      ...(await host()),
      terminal: () => manager,
      policy: async () => ({ ...(await desktopOn()), shell: false }),
    })
    try {
      sendTerminal(socket, "c1", "terminal_open", {})

      const result = await resultOf(socket, "c1")

      assert.isFalse(result.ok)
      assert.strictEqual(result.error?.code, "denied")
      assert.strictEqual(manager.list().terminals.length, 0)
    } finally {
      manager.closeAll()
      link.stop()
      reset()
    }
  })

  it("says a machine without a pty cannot open one", async () => {
    const { link, socket } = await openLink(await host())
    try {
      sendTerminal(socket, "c1", "terminal_open", {})

      const result = await resultOf(socket, "c1")

      assert.isFalse(result.ok)
      assert.strictEqual(result.error?.code, "unsupported")
    } finally {
      link.stop()
      reset()
    }
  })
})

describe("driver calls", () => {
  it("forwards a driver call to the kiko app", async () => {
    const { driver, calls } = fakeDriver()
    const { link, socket } = await openLink({ ...(await host()), driver: () => driver, policy: desktopOn })
    try {
      sendDriver(socket, "c1", { method: "desktop.tools" })

      const result = await resultOf(socket, "c1")

      assert.isTrue(result.ok)
      assert.deepStrictEqual(result.value, { windows: [] })
      assert.deepStrictEqual(calls, [{ method: "desktop.tools" }])
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
      sendDriver(socket, "c1", { method: "desktop.tools" })

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
      sendDriver(socket, "c1", { method: "desktop.tools" })

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
      sendDriver(socket, "c1", { method: "desktop.tools" })

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
      sendDriver(socket, "c1", { method: "desktop.tools" })

      const result = await resultOf(socket, "c1")

      assert.isFalse(result.ok)
      assert.strictEqual(result.error?.code, "unsupported")
    } finally {
      link.stop()
      reset()
    }
  })

  it("answers cancelled when the worker cancels a call the app settled anyway", async () => {
    const driver: Driver = {
      call: (_call, deadline) =>
        new Promise((resolve) => {
          const settle = () => resolve({ windows: [] })
          if (deadline.signal.aborted) settle()
          else deadline.signal.addEventListener("abort", settle, { once: true })
        }),
      state: () => null,
      background: () => false,
      browser: () => false,
      close: () => {},
    }
    const { link, socket } = await openLink({ ...(await host()), driver: () => driver, policy: desktopOn })
    try {
      sendDriver(socket, "c1", { method: "desktop.tools" })
      socket.emit("message", { data: JSON.stringify({ t: "cancel", id: "c1" }) })

      const result = await resultOf(socket, "c1")

      assert.isFalse(result.ok)
      assert.strictEqual(result.error?.code, "cancelled")
    } finally {
      link.stop()
      reset()
    }
  })

  it("keeps the link when a live frame throws", async () => {
    const { driver } = fakeDriver()
    const { link, socket } = await openLink({
      ...(await host()),
      driver: () => driver,
      policy: desktopOn,
      live: {
        rtc() {
          throw new Error("a bad sdp")
        },
        live() {},
        input() {},
        control() {},
        ack() {},
      },
    })
    try {
      socket.emit("message", {
        data: JSON.stringify({ t: "rtc", session: "s", signal: { type: "offer", sdp: "not an sdp" } }),
      })
      sendDriver(socket, "c1", { method: "desktop.tools" })

      const result = await resultOf(socket, "c1")

      assert.isTrue(result.ok)
    } finally {
      link.stop()
      reset()
    }
  })
})

describe("browser steps", () => {
  const steps = [
    { ref: 2, action: "click" },
    { ref: 3, action: "type", text: "hello" },
  ]

  it("runs the steps in order and reads the page once at the end", async () => {
    const { driver, calls } = fakeBrowser()
    const { link, socket } = await openLink({ ...(await host()), driver: () => driver, policy: desktopOn })
    try {
      sendBrowserSteps(socket, "b1", { tab: "t-1", steps, read: true, image: false })

      const result = await resultOf(socket, "b1")

      assert.isTrue(result.ok, JSON.stringify(result))
      assert.deepStrictEqual(result.value, { done: 2, page: PAGE })
      assert.deepStrictEqual(calls, [
        { method: "browser.act", params: { tab: "t-1", ref: 2, action: "click" } },
        { method: "browser.act", params: { tab: "t-1", ref: 3, action: "type", text: "hello" } },
        { method: "browser.read", params: { tab: "t-1", image: false } },
      ])
    } finally {
      link.stop()
      reset()
    }
  })

  it("stops at the first step that fails and still reads the page", async () => {
    const { driver, calls } = fakeBrowser((call) => {
      if (call.method === "browser.act" && call.params.ref === 3)
        throw new Fail({ code: "stale", message: "that ref is stale; read the page again" })
    })
    const { link, socket } = await openLink({ ...(await host()), driver: () => driver, policy: desktopOn })
    try {
      sendBrowserSteps(socket, "b1", { tab: "t-1", steps: [...steps, { ref: 4, action: "click" }], read: true })

      const result = await resultOf(socket, "b1")

      assert.isTrue(result.ok, JSON.stringify(result))
      assert.deepStrictEqual(result.value, {
        done: 1,
        failed: { index: 1, code: "stale", error: "that ref is stale; read the page again" },
        page: PAGE,
      })
      assert.deepStrictEqual(
        calls.map((call) => call.method),
        ["browser.act", "browser.act", "browser.read"],
      )
    } finally {
      link.stop()
      reset()
    }
  })

  it("stops before the next step when the owner takes over", async () => {
    let holder: "agent" | "human" = "agent"
    const { driver, calls } = fakeBrowser((call) => {
      if (call.method === "browser.act") holder = "human"
    })
    const { link, socket } = await openLink({
      ...(await host()),
      driver: () => driver,
      policy: desktopOn,
      holder: () => holder,
    })
    try {
      sendBrowserSteps(socket, "b1", { tab: "t-1", steps, read: true })

      const result = await resultOf(socket, "b1")

      assert.isTrue(result.ok, JSON.stringify(result))
      assert.deepStrictEqual(result.value, { done: 1, stoppedBy: "owner" })
      assert.strictEqual(calls.length, 1)
    } finally {
      link.stop()
      reset()
    }
  })

  it("refuses the batch when the policy turns browser input off", async () => {
    const { driver, calls } = fakeBrowser()
    const { link, socket } = await openLink({
      ...(await host()),
      driver: () => driver,
      policy: async () => ({ ...(await desktopOn()), input: false }),
    })
    try {
      sendBrowserSteps(socket, "b1", { tab: "t-1", steps, read: true })

      const result = await resultOf(socket, "b1")

      assert.isFalse(result.ok)
      assert.strictEqual(result.error?.code, "denied")
      assert.strictEqual(calls.length, 0)
    } finally {
      link.stop()
      reset()
    }
  })
})

describe("resumable calls", () => {
  function heldShell() {
    let exited: (code: number) => void = () => {}
    const proc = { pid: 5150, stdout: undefined, stderr: undefined, exited: new Promise<number>((r) => (exited = r)) }
    let spawns = 0
    vi.stubGlobal("Bun", {
      spawn: () => {
        spawns += 1
        return proc
      },
      spawnSync: () => ({}),
    })
    return { spawns: () => spawns, finish: () => exited(0) }
  }

  function shellCall(socket: FakeSocket, id: string) {
    socket.emit("message", {
      data: JSON.stringify({ t: "call", id, op: "shell", args: { command: "build" }, deadlineMs: 60_000 }),
    })
  }

  async function swap(link: { open(): Promise<void> }, before: number) {
    void link.open()
    await vi.waitFor(() => assert.strictEqual(FakeSocket.made.length, before + 1))
    const second = FakeSocket.made[before]!
    second.open()
    return second
  }

  function helloOf(socket: FakeSocket) {
    const frame = socket.sent.map((text) => JSON.parse(text as string) as { resume?: unknown })
    return frame.find((parsed) => parsed.resume !== undefined)
  }

  it("keeps a running shell call through a socket swap and returns its output once", async () => {
    const shell = heldShell()
    const { link, socket } = await openLink({ ...(await host()), policy: desktopOn })
    try {
      const opening = link as unknown as { open(): Promise<void> }
      shellCall(socket, "c1")
      await vi.waitFor(() => assert.strictEqual(shell.spawns(), 1))

      socket.emit("close", { code: 1006 })
      const second = await swap(opening, 1)

      assert.deepStrictEqual(helloOf(second)?.resume, { running: ["c1"], recent: [] })
      assert.strictEqual(resultsOf(socket, "c1").length, 0)

      shell.finish()

      assert.isTrue((await resultOf(second, "c1")).ok)
      assert.strictEqual(resultsOf(second, "c1").length, 1)
      assert.strictEqual(shell.spawns(), 1)
    } finally {
      link.stop()
      reset()
    }
  })

  it("answers a shell call that finished during the gap from the recent results", async () => {
    const shell = heldShell()
    const { link, socket } = await openLink({ ...(await host()), policy: desktopOn })
    try {
      const opening = link as unknown as { open(): Promise<void> }
      shellCall(socket, "c1")
      await vi.waitFor(() => assert.strictEqual(shell.spawns(), 1))

      socket.emit("close", { code: 1006 })
      shell.finish()
      await vi.waitFor(() => assert.isFalse(link.busy()))
      const second = await swap(opening, 1)

      assert.deepStrictEqual(helloOf(second)?.resume, { running: [], recent: ["c1"] })

      shellCall(second, "c1")

      assert.isTrue((await resultOf(second, "c1")).ok)
      assert.strictEqual(shell.spawns(), 1)
    } finally {
      link.stop()
      reset()
    }
  })

  it("reports no call when the daemon never saw one", async () => {
    const { link, socket } = await openLink({ ...(await host()), policy: desktopOn })
    try {
      const opening = link as unknown as { open(): Promise<void> }
      socket.emit("close", { code: 1006 })
      const second = await swap(opening, 1)

      assert.deepStrictEqual(helloOf(second)?.resume, { running: [], recent: [] })
      assert.strictEqual(second.sent.length, 1)
    } finally {
      link.stop()
      reset()
    }
  })

  it("kills the process group when the worker cancels a shell call", async () => {
    let exited: (code: number) => void = () => {}
    let spawned: () => void = () => {}
    const started = new Promise<void>((r) => (spawned = r))
    const proc = { pid: 4242, stdout: undefined, stderr: undefined, exited: new Promise<number>((r) => (exited = r)) }
    vi.stubGlobal("Bun", {
      spawn: () => {
        spawned()
        return proc
      },
    })
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      exited(137)
      return true
    })
    const { link, socket } = await openLink({ ...(await host()), policy: desktopOn })
    try {
      socket.emit("message", {
        data: JSON.stringify({ t: "call", id: "c1", op: "shell", args: { command: "sleep 30" }, deadlineMs: 60_000 }),
      })
      await started
      socket.emit("message", { data: JSON.stringify({ t: "cancel", id: "c1" }) })

      const result = await resultOf(socket, "c1")

      assert.isFalse(result.ok)
      assert.strictEqual(result.error?.code, "cancelled")
      assert.deepStrictEqual(kill.mock.calls, [[-4242, "SIGKILL"]])
    } finally {
      kill.mockRestore()
      link.stop()
      reset()
    }
  })
})

function resultsOf(socket: FakeSocket, id: string): Result[] {
  return socket.sent
    .map((text) => JSON.parse(text as string) as Result)
    .filter((frame) => frame.t === "result" && frame.id === id)
}

describe("driver input policy", () => {
  const inputOff = async () => ({ ...(await desktopOn()), input: false })

  const typing = [
    { method: "desktop.call", params: { name: "click", args: { x: 1, y: 2 } } },
    { method: "browser.act", params: { tab: "t", ref: 1, action: "click" } },
    { method: "browser.open", params: { url: "https://example.com" } },
  ]

  it("refuses every call that would type or click", async () => {
    for (const call of typing) {
      const { driver, calls } = fakeDriver()
      const { link, socket } = await openLink({
        ...(await host()),
        driver: () => driver,
        policy: inputOff,
      })
      try {
        sendDriver(socket, "c1", call)

        const result = await resultOf(socket, "c1")

        assert.isFalse(result.ok, call.method)
        assert.strictEqual(result.error?.code, "denied", call.method)
        assert.strictEqual(calls.length, 0, call.method)
      } finally {
        link.stop()
        reset()
      }
    }
  })

  it("still lists the desktop tools with input off", async () => {
    const { driver, calls } = fakeDriver()
    const { link, socket } = await openLink({ ...(await host()), driver: () => driver, policy: inputOff })
    try {
      sendDriver(socket, "c1", { method: "desktop.tools" })

      assert.isTrue((await resultOf(socket, "c1")).ok)
      assert.strictEqual(calls.length, 1)
    } finally {
      link.stop()
      reset()
    }
  })
})
