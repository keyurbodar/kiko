import { describe, expect, it } from "vitest"
import * as Schema from "effect/Schema"
import { Hello, PROTOCOL, ToDaemon } from "./wire"

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

  it("decodes the desktop tool list a daemon reports", () => {
    const hello = Schema.decodeUnknownSync(Hello)({
      ...OLD,
      desktop: {
        version: "0.38.0",
        tools: [{ name: "list_windows", description: "List windows", inputSchema: { type: "object" } }],
      },
    })

    expect(hello.desktop?.version).toBe("0.38.0")
    expect(hello.desktop?.tools[0]?.name).toBe("list_windows")
    expect(hello.desktop?.tools[0]?.inputSchema).toEqual({ type: "object" })
  })
})

describe("driver calls", () => {
  it("decodes a call frame that carries a driver call", () => {
    const frame = Schema.decodeUnknownSync(ToDaemon)({
      t: "call",
      id: "c1",
      op: "driver",
      args: { method: "desktop.call", params: { name: "click", args: { x: 4, y: 8 } } },
      deadlineMs: 30_000,
    })

    expect(frame.t).toBe("call")
  })
})
