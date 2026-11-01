import { describe, expect, it, vi } from "vitest"
import { createClipboard, type Command, type Spawned } from "./clipboard"
import type { Tools } from "./tools"

function driver(tools: Record<string, (args: Record<string, unknown>) => unknown>): Tools {
  return {
    has: (name) => name in tools,
    call: (name, args) => {
      const run = tools[name]
      return run ? Promise.resolve(run(args)) : Promise.reject(new Error(`no ${name}`))
    },
  }
}

const reply = (structuredContent: Record<string, unknown>) => ({ content: [], structuredContent })

const system = () => {
  const ran: { cmd: string[]; stdin?: string }[] = []
  const answer = (code: number, out = "") => Promise.resolve<Command>({ code, out })
  return { ran, answer }
}

const starters = (codes: readonly number[]) => {
  const started: { cmd: string[]; stdin: string }[] = []
  const spawn = (cmd: string[], stdin: string): Spawned => {
    started.push({ cmd, stdin })
    return { exited: Promise.resolve(codes[started.length - 1] ?? 1) }
  }
  return { started, spawn }
}

describe("the remote clipboard", () => {
  it("writes through the cua clipboard tool", async () => {
    const writes: unknown[] = []
    const clipboard = createClipboard({
      platform: "linux",
      tools: () =>
        driver({
          clipboard_write: (args) => {
            writes.push(args)
            return reply({ types: ["text/plain"] })
          },
        }),
      run: () => Promise.resolve({ code: 1, out: "" }),
    })

    expect(await clipboard.write("héllo\nwörld")).toBe(true)
    expect(writes).toEqual([{ text: "héllo\nwörld" }])
  })

  it("reads plain text through the cua clipboard tool", async () => {
    const asked: unknown[] = []
    const clipboard = createClipboard({
      platform: "linux",
      tools: () =>
        driver({
          clipboard_read: (args) => {
            asked.push(args)
            return reply({ supported: true, types: ["text/plain"], text: "from the computer" })
          },
        }),
      run: () => Promise.resolve({ code: 1, out: "" }),
    })

    expect(await clipboard.read()).toBe("from the computer")
    expect(asked).toEqual([{ include_text: true }])
  })

  it("falls back to the OS when the driver has no clipboard tool", async () => {
    const { ran, answer } = system()
    const clipboard = createClipboard({
      platform: "macos",
      tools: () => driver({}),
      run: (cmd, stdin) => {
        ran.push({ cmd, stdin })
        return cmd[0] === "pbpaste" ? answer(0, "copied on the mac") : answer(0)
      },
    })

    expect(await clipboard.read()).toBe("copied on the mac")
    expect(await clipboard.write("sent to the mac")).toBe(true)
    expect(ran).toEqual([
      { cmd: ["pbpaste"], stdin: undefined },
      { cmd: ["pbcopy"], stdin: "sent to the mac" },
    ])
  })

  it("tries wl-copy before xclip on Linux and reports what worked", async () => {
    const { started, spawn } = starters([1, 0])
    const clipboard = createClipboard({ platform: "linux", spawn })

    expect(await clipboard.write("text")).toBe(true)
    expect(started.map((entry) => entry.cmd[0])).toEqual(["wl-copy", "xclip"])
    expect(started[1]?.cmd).toEqual(["xclip", "-selection", "clipboard", "-i"])
    expect(started[1]?.stdin).toBe("text")
  })

  it("keeps the Linux selection owner running instead of waiting for it to exit", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    try {
      const started: string[][] = []
      const spawn = (cmd: string[]): Spawned => {
        started.push(cmd)
        return { exited: new Promise(() => {}) }
      }
      const clipboard = createClipboard({ platform: "linux", spawn, tools: () => driver({}) })

      const writing = clipboard.write("held by the daemon")
      await vi.advanceTimersByTimeAsync(2_000)

      expect(await writing).toBe(true)
      expect(started).toEqual([["wl-copy"]])
    } finally {
      vi.useRealTimers()
    }
  })

  it("fails quietly when no clipboard exists at all", async () => {
    const clipboard = createClipboard({
      platform: "linux",
      run: () => Promise.resolve({ code: 127, out: "" }),
      spawn: () => ({ exited: Promise.resolve(1) }),
    })

    expect(await clipboard.read()).toBeNull()
    expect(await clipboard.write("")).toBe(false)
  })

  it("uses the OS clipboard when the driver clipboard errors", async () => {
    const started: string[] = []
    const clipboard = createClipboard({
      platform: "linux",
      tools: () => driver({ clipboard_write: () => Promise.reject(new Error("not supported here")) }),
      spawn: (cmd) => {
        started.push(cmd[0] ?? "")
        return { exited: Promise.resolve(0) }
      },
    })

    expect(await clipboard.write("fallback")).toBe(true)
    expect(started).toEqual(["wl-copy"])
  })
})
