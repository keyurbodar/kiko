import { describe, expect, it } from "vitest"
import * as Schema from "effect/Schema"
import { Calls, Hello, PROTOCOL, ToDaemon } from "./wire"

const OLD = {
  t: "hello",
  protocol: PROTOCOL,
  version: "0.1.0",
  os: "macos",
  arch: "arm64",
  host: "mac",
  caps: { shell: true, files: true, desktop: true, live: true, input: true },
  displays: [],
}

describe("hello", () => {
  it("decodes a hello from a daemon that has no driver", () => {
    const hello = Schema.decodeUnknownSync(Hello)(OLD)

    expect(hello.caps.background).toBeUndefined()
    expect(hello.caps.browser).toBeUndefined()
    expect(hello.driver).toBeUndefined()
  })

  it("decodes background caps and the driver status", () => {
    const hello = Schema.decodeUnknownSync(Hello)({
      ...OLD,
      caps: { ...OLD.caps, background: true, browser: true },
      driver: {
        permissions: { accessibility: "granted", screen: "granted", automation: "not_needed" },
        browsers: [{ name: "chrome", state: "connected" }],
      },
    })

    expect(hello.caps.background).toBe(true)
    expect(hello.driver?.browsers).toEqual([{ name: "chrome", state: "connected" }])
  })

  it("decodes terminal caps", () => {
    const hello = Schema.decodeUnknownSync(Hello)({ ...OLD, caps: { ...OLD.caps, terminal: true } })

    expect(hello.caps.terminal).toBe(true)
  })

  it("decodes the calls a reconnecting daemon is still running or holding results for", () => {
    const hello = Schema.decodeUnknownSync(Hello)({ ...OLD, resume: { running: ["c1"], recent: ["c2", "c3"] } })

    expect(hello.resume).toEqual({ running: ["c1"], recent: ["c2", "c3"] })
  })

  it("rejects a resume report with no recent ids", () => {
    expect(() => Schema.decodeUnknownSync(Hello)({ ...OLD, resume: { running: ["c1"] } })).toThrow()
  })

  it("rejects a resume report that is not a list of ids", () => {
    expect(() => Schema.decodeUnknownSync(Hello)({ ...OLD, resume: { running: "c1", recent: [] } })).toThrow()
    expect(() => Schema.decodeUnknownSync(Hello)({ ...OLD, resume: { running: [1], recent: [] } })).toThrow()
  })
})

describe("terminal calls", () => {
  const call = (op: string, args: unknown) => ({ t: "call", id: "c1", op, args, deadlineMs: 30_000 })

  it("decodes every terminal op", () => {
    const frames = [
      call("terminal_open", { cwd: "~", shell: "/bin/bash", cols: 100, rows: 40, name: "repl" }),
      call("terminal_send", { id: "t-1", text: "ls", keys: ["enter"] }),
      call("terminal_read", { id: "t-1", mode: "screen" }),
      call("terminal_wait", { id: "t-1", until: ">>>", regex: false, timeoutMs: 10_000 }),
      call("terminal_resize", { id: "t-1", cols: 100, rows: 40 }),
      call("terminal_close", { id: "t-1" }),
      call("terminal_list", {}),
    ]

    for (const frame of frames) expect(Schema.decodeUnknownSync(ToDaemon)(frame).t).toBe("call")
  })

  it("rejects a read mode it does not have", () => {
    expect(() => Schema.decodeUnknownSync(Calls.terminal_read.args)({ id: "t-1", mode: "all" })).toThrow()
  })

  it("rejects a terminal size outside the bounds", () => {
    expect(() => Schema.decodeUnknownSync(Calls.terminal_open.args)({ cols: 10, rows: 40 })).toThrow()
    expect(() => Schema.decodeUnknownSync(Calls.terminal_open.args)({ cols: 100, rows: 1 })).toThrow()
  })

  it("round-trips a read value", () => {
    const value = {
      id: "t-1",
      mode: "tail" as const,
      text: "done",
      truncated: false,
      cols: 120,
      rows: 30,
      status: "exited" as const,
      exitCode: 0,
    }
    const encoded = Schema.encodeSync(Calls.terminal_read.value)(value)

    expect(Schema.decodeUnknownSync(Calls.terminal_read.value)(encoded)).toEqual(value)
  })
})

describe("driver calls", () => {
  it("decodes a call frame that carries a driver call", () => {
    const frame = Schema.decodeUnknownSync(ToDaemon)({
      t: "call",
      id: "c1",
      op: "driver",
      args: { method: "act", params: { window: "w-1", action: "press", ref: 4, mode: "background" } },
      deadlineMs: 30_000,
    })

    expect(frame.t).toBe("call")
  })
})
