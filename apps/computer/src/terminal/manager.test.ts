import { afterEach, describe, expect, it, vi } from "@effect/vitest"
import { TerminalManager } from "./manager"
import type { Pty, PtyInput } from "./pty"
import type { Screen } from "./screen"

type Fake = {
  input: PtyInput | null
  writes: string[]
  resizes: [number, number][]
  killed: boolean
  closed: boolean
  emit(text: string): void
  emitBytes(bytes: Uint8Array): void
  exit(code?: number | null): void
  pty: Pty
}

function fakePty(): Fake {
  let settle: (code: number | null) => void = () => {}
  const exited = new Promise<number | null>((done) => {
    settle = done
  })
  const fake: Fake = {
    input: null,
    writes: [],
    resizes: [],
    killed: false,
    closed: false,
    emit: (text) => fake.input?.onData(new TextEncoder().encode(text)),
    emitBytes: (bytes) => fake.input?.onData(bytes),
    exit: (code = 0) => {
      fake.input?.onExit(code)
      settle(code)
    },
    pty: {
      pid: 42,
      write: (data) => fake.writes.push(data),
      resize: (cols, rows) => fake.resizes.push([cols, rows]),
      kill: () => {
        fake.killed = true
        fake.exit(0)
      },
      close: () => {
        fake.closed = true
      },
      exited,
    },
  }
  return fake
}

function fakeScreen() {
  let value = ""
  let disposed = false
  const screen: Screen = {
    write: (text, done) => {
      if (!disposed) value += text
      done?.()
    },
    text: () => value,
    resize: () => {},
    dispose: () => {
      disposed = true
    },
  }
  return screen
}

function harness() {
  const fake = fakePty()
  const screens: Screen[] = []
  const manager = new TerminalManager({
    spawn: (input) => {
      fake.input = input
      return fake.pty
    },
    screen: () => {
      const screen = fakeScreen()
      screens.push(screen)
      return screen
    },
  })
  return { fake, manager, screens }
}

afterEach(() => {
  vi.useRealTimers()
})

describe("terminal_open", () => {
  it("starts the shell in the home folder and returns its id", () => {
    const { fake, manager } = harness()

    const opened = manager.open({ name: "repl" })

    expect(opened.name).toBe("repl")
    expect(opened.status).toBe("running")
    expect(opened.cols).toBe(120)
    expect(opened.rows).toBe(30)
    expect(fake.input?.command.join(" ")).toBe(opened.shell)
    expect(manager.list().terminals).toHaveLength(1)
  })

  it("names terminals after their shell", () => {
    const { manager } = harness()

    expect(manager.open({ shell: "/bin/bash" }).name).toBe("bash 1")
    expect(manager.open({ shell: "/bin/bash" }).name).toBe("bash 2")
  })

  it("refuses more terminals than the cap", () => {
    const { manager } = harness()
    for (let index = 0; index < 16; index += 1) manager.open({})

    expect(() => manager.open({})).toThrow(/already has 16 terminals/)
  })

  it("reports a shell that cannot start", () => {
    const manager = new TerminalManager({
      spawn: () => {
        throw new Error("no such shell")
      },
      screen: fakeScreen,
    })

    expect(() => manager.open({ shell: "/nope" })).toThrow(/could not start \/nope/)
  })
})

describe("terminal_send", () => {
  it("writes the text and then the keys as separate input", async () => {
    const { fake, manager } = harness()
    const opened = manager.open({})

    const sent = await manager.send({ id: opened.id, text: "ls", keys: ["enter"] })

    expect(fake.writes).toEqual(["ls", "\r"])
    expect(sent.bytes).toBe(3)
  })

  it("refuses a key it cannot send", () => {
    const { manager } = harness()
    const opened = manager.open({})

    expect(() => manager.send({ id: opened.id, keys: ["cmd+l"] })).toThrow(/does not know the key cmd\+l/)
  })

  it("needs text or keys", () => {
    const { manager } = harness()
    const opened = manager.open({})

    expect(() => manager.send({ id: opened.id })).toThrow(/needs text, keys/)
  })

  it("refuses an unknown terminal and names the open ones", () => {
    const { manager } = harness()
    const opened = manager.open({})

    expect(() => manager.send({ id: "nope", text: "x" })).toThrow(new RegExp(`the open terminals are ${opened.id}`))
  })

  it("waits for the output in the same call when until is given", async () => {
    const { fake, manager } = harness()
    const opened = manager.open({})
    const sent = manager.send({ id: opened.id, text: "echo hi", keys: ["enter"], until: "hi" })

    fake.emit("echo hi\r\nhi\r\n")

    await expect(Promise.resolve(sent)).resolves.toMatchObject({
      id: opened.id,
      bytes: 8,
      matched: true,
      timedOut: false,
    })
    expect((await sent).text).toContain("hi")
  })

  it("resolves at once when the text is already on screen", async () => {
    const { fake, manager } = harness()
    const opened = manager.open({})
    fake.emit("ready\n")

    await expect(Promise.resolve(manager.send({ id: opened.id, text: "x", until: "ready" }))).resolves.toMatchObject({
      matched: true,
    })
  })

  it("times the wait out without polling", async () => {
    vi.useFakeTimers()
    const { manager } = harness()
    const opened = manager.open({})
    const sent = manager.send({ id: opened.id, text: "x", until: "never", timeoutMs: 5_000 })

    await vi.advanceTimersByTimeAsync(5_000)

    await expect(Promise.resolve(sent)).resolves.toMatchObject({ matched: false, timedOut: true, exited: false })
  })

  it("refuses a bad regular expression before typing", () => {
    const { fake, manager } = harness()
    const opened = manager.open({})

    expect(() => manager.send({ id: opened.id, text: "x", until: "(", regex: true })).toThrow(
      /not a valid regular expression/,
    )
    expect(fake.writes).toEqual([])
  })
})

describe("terminal_read", () => {
  it("returns the visible screen", async () => {
    const { fake, manager } = harness()
    const opened = manager.open({})
    fake.emit("hello\r\n")

    expect((await manager.read({ id: opened.id, mode: "screen" })).text).toBe("hello\r\n")
  })

  it("returns the tail without escape codes and says when it was cut", async () => {
    const { fake, manager } = harness()
    const opened = manager.open({})
    fake.emit("one\ntwo\nthree\n\x1b[31mfour\x1b[0m\n")

    expect(await manager.read({ id: opened.id, mode: "tail", lines: 2 })).toMatchObject({
      text: "three\nfour\n",
      truncated: true,
    })
    expect(await manager.read({ id: opened.id, mode: "tail", lines: 10 })).toMatchObject({
      text: "one\ntwo\nthree\nfour\n",
      truncated: false,
    })
  })

  it("joins a code point split across reads", async () => {
    const { fake, manager } = harness()
    const opened = manager.open({})
    const bytes = new TextEncoder().encode("😀")
    fake.emitBytes(bytes.slice(0, 2))
    fake.emitBytes(bytes.slice(2))

    const read = await manager.read({ id: opened.id, mode: "tail" })

    expect(read.text).toBe("😀")
  })

  it("reports an exited terminal and its code", async () => {
    const { fake, manager } = harness()
    const opened = manager.open({})
    fake.emit("bye\n")
    fake.exit(3)

    expect(await manager.read({ id: opened.id, mode: "tail" })).toMatchObject({
      text: "bye\n",
      status: "exited",
      exitCode: 3,
    })
  })
})

describe("terminal_wait", () => {
  it("resolves when the text appears", async () => {
    const { fake, manager } = harness()
    const opened = manager.open({})
    const waiting = manager.wait({ id: opened.id, until: ">>>" })

    fake.emit("Python 3.12\r\n>>> ")

    const out = await waiting
    expect(out).toMatchObject({ matched: true, timedOut: false, exited: false })
    expect(out.text).toContain(">>>")
  })

  it("resolves at once when the text is already there", async () => {
    const { fake, manager } = harness()
    const opened = manager.open({})
    fake.emit("done\n")

    await expect(manager.wait({ id: opened.id, until: "done" })).resolves.toMatchObject({ matched: true })
  })

  it("supports a regular expression", async () => {
    const { fake, manager } = harness()
    const opened = manager.open({})
    const waiting = manager.wait({ id: opened.id, until: "\\$\\s*$", regex: true })

    fake.emit("user@host:~$ ")

    await expect(waiting).resolves.toMatchObject({ matched: true })
  })

  it("needs some text to look for", () => {
    const { manager } = harness()
    const opened = manager.open({})

    expect(() => manager.wait({ id: opened.id, until: "" })).toThrow(/needs some text/)
  })

  it("reports an invalid regular expression", () => {
    const { manager } = harness()
    const opened = manager.open({})

    expect(() => manager.wait({ id: opened.id, until: "(", regex: true })).toThrow(/not a valid regular expression/)
  })

  it("times out without polling", async () => {
    vi.useFakeTimers()
    const { manager } = harness()
    const opened = manager.open({})
    const waiting = manager.wait({ id: opened.id, until: "never", timeoutMs: 5_000 })

    await vi.advanceTimersByTimeAsync(5_000)

    await expect(waiting).resolves.toMatchObject({ matched: false, timedOut: true, exited: false })
  })

  it("waits for the screen to catch up before matching the tail", async () => {
    const fake = fakePty()
    const pending: (() => void)[] = []
    let value = ""
    const manager = new TerminalManager({
      spawn: (input) => {
        fake.input = input
        return fake.pty
      },
      screen: () => ({
        write: (text, done) => {
          value += text
          pending.push(() => done?.())
        },
        text: () => value,
        resize: () => {},
        dispose: () => {},
      }),
    })
    const opened = manager.open({})
    const waiting = manager.wait({ id: opened.id, until: "ready" })
    let settled = false
    void waiting.then(() => {
      settled = true
    })

    fake.emit("ready")
    await Promise.resolve()

    expect(settled).toBe(false)
    pending.shift()?.()
    await expect(waiting).resolves.toMatchObject({ matched: true })
  })

  it("resolves when the terminal exits first", async () => {
    const { fake, manager } = harness()
    const opened = manager.open({})
    const waiting = manager.wait({ id: opened.id, until: "never" })

    fake.exit(1)

    await expect(waiting).resolves.toMatchObject({ matched: false, timedOut: false, exited: true })
  })

  it("stops waiting when the call is cancelled", async () => {
    const { manager } = harness()
    const opened = manager.open({})
    const controller = new AbortController()
    const waiting = manager.wait({ id: opened.id, until: "never" }, controller.signal)

    controller.abort(new Error("cancelled"))

    await expect(waiting).rejects.toThrow("cancelled")
  })
})

describe("terminal_resize", () => {
  it("resizes the screen and the pty", async () => {
    const { fake, manager } = harness()
    const opened = manager.open({})

    const resized = manager.resize({ id: opened.id, cols: 100, rows: 40 })

    expect(resized).toEqual({ id: opened.id, cols: 100, rows: 40 })
    expect(fake.resizes).toEqual([[100, 40]])
    expect(await manager.read({ id: opened.id, mode: "screen" })).toMatchObject({ cols: 100, rows: 40 })
  })
})

describe("terminal_close", () => {
  it("kills the pty and forgets the terminal", async () => {
    const { fake, manager } = harness()
    const opened = manager.open({})

    await expect(manager.close({ id: opened.id })).resolves.toEqual({ id: opened.id, closed: true })
    expect(fake.killed).toBe(true)
    expect(manager.list().terminals).toEqual([])
  })
})

describe("idle close", () => {
  it("closes a terminal nobody used", async () => {
    vi.useFakeTimers()
    const { fake, manager } = harness()
    manager.open({})

    await vi.advanceTimersByTimeAsync(30 * 60_000)

    expect(fake.killed).toBe(true)
    expect(manager.list().terminals).toEqual([])
  })

  it("keeps a terminal that is being read", async () => {
    vi.useFakeTimers()
    const { manager } = harness()
    const opened = manager.open({})

    await vi.advanceTimersByTimeAsync(20 * 60_000)
    await manager.read({ id: opened.id, mode: "screen" })
    await vi.advanceTimersByTimeAsync(20 * 60_000)

    expect(manager.list().terminals).toHaveLength(1)
  })
})
