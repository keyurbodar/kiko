import { describe, expect, it } from "@effect/vitest"
import type { Context } from "@earendil-works/chord"
import type { ToolExecutionApi } from "@earendil-works/pi-durable"
import type { DesktopTool, DriverCall, Page, Tab } from "@kiko/computer/driver"
import { afterEach, beforeEach, vi } from "vitest"
import type { ComputerPort } from "./port"
import { computerExtension, computerInfoExtension } from "./tools"
import type { ComputerCallOutcome, ComputerSummary } from "./types"

type Answer = (call: DriverCall) => ComputerCallOutcome

const TAB: Tab = {
  id: "t-1",
  browser: "chrome",
  window_id: 1,
  index: 0,
  active: true,
  title: "Inbox",
  url: "https://mail.example/",
}

const PAGE: Page = { tab: TAB, nodes: [], outline: '[2] link "Compose"' }

const DESKTOP: DesktopTool[] = [
  {
    name: "list_windows",
    description: "List top-level windows",
    inputSchema: { type: "object", properties: { pid: { type: "integer" } } },
  },
  {
    name: "type_text",
    description: "Type text into an element",
    inputSchema: {
      type: "object",
      properties: { target: { type: "object" }, text: { type: "string" } },
      required: ["target", "text"],
    },
  },
]

function summary(extra: Partial<ComputerSummary> = {}): ComputerSummary {
  return {
    id: "pc-1",
    name: "Mac",
    os: "macos",
    online: true,
    caps: {
      shell: true,
      files: true,
      desktop: true,
      live: true,
      input: true,
      background: true,
      browser: true,
      steps: true,
    },
    holder: "agent",
    displays: [],
    background: true,
    browsers: [{ name: "chrome", state: "connected" }],
    ...extra,
  }
}

function harness(
  pc: ComputerSummary,
  answer: Answer,
  desktop: readonly DesktopTool[] = DESKTOP,
  sees = false,
  steps?: (args: { steps: readonly { ref: number; action: string }[] }) => ComputerCallOutcome,
) {
  const calls: DriverCall[] = []
  const batches: { steps: readonly { ref: number; action: string }[] }[] = []
  const port: ComputerPort = {
    list: async () => [pc],
    desktopTools: async () => desktop,
    resolve: async () => pc,
    call: async (_pcId, op, args) => {
      if (op === "driver") {
        const call = args as DriverCall
        calls.push(call)
        return answer(call)
      }
      if (op !== "browser_steps") throw new Error(`unexpected op ${op}`)
      const batch = args as { steps: readonly { ref: number; action: string }[] }
      batches.push(batch)
      return steps ? steps(batch) : { ok: true, value: { done: batch.steps.length, page: PAGE } }
    },
    link: async () => ({ ok: true }),
  }
  const tools = computerExtension({ port: () => port, acceptsImages: () => sees, desktop }).tools ?? []
  const tool = (name: string) => {
    const found = tools.find((entry) => entry.name === name)
    if (!found) throw new Error(`no ${name} tool`)
    return found
  }
  return { batches, calls, tools, tool }
}

const api = {
  conversationId: 0,
  agent: async () => ({ model: undefined }),
  env: undefined,
} as unknown as ToolExecutionApi

const context = {} as Context

const textOf = (out: { output?: readonly { type: string; text?: string }[] }) =>
  (out.output ?? []).map((part) => part.text ?? "").join("")

const LIST_NOW = Date.parse("2026-10-31T12:00:00.000Z")

describe("computer_list", () => {
  beforeEach(() => vi.useFakeTimers({ now: LIST_NOW }))
  afterEach(() => vi.useRealTimers())

  it("lists every computer with its daemon version and why the offline one dropped", async () => {
    const online = summary({ version: "3.1.0" })
    const offline = summary({
      id: "pc-2",
      name: "build-box",
      os: "linux",
      online: false,
      version: "3.0.0",
      lastSeenAt: LIST_NOW - 60_000,
      lastCloseReason: "the network dropped",
    })
    const port: ComputerPort = {
      list: async () => [online, offline],
      resolve: async () => online,
      call: async () => ({ ok: true, value: undefined }),
      link: async () => ({ ok: true }),
      desktopTools: async () => [],
    }
    const tools = computerInfoExtension({ port: () => port, acceptsImages: () => false, desktop: [] }).tools ?? []
    const list = tools.find((entry) => entry.name === "computer_list")
    if (!list) throw new Error("no computer_list tool")

    const out = await list.execute({}, api, context)

    expect(textOf(out)).toContain("Mac (id pc-1): macos, online")
    expect(textOf(out)).toContain("daemon 3.1.0.")
    expect(textOf(out)).toContain("build-box (id pc-2): linux, offline")
    expect(textOf(out)).toContain("last seen 1 minute ago.")
    expect(textOf(out)).toContain("the last connection ended because the network dropped.")
  })
})

describe("desktop tools", () => {
  it("passes the daemon's tool list through with the desktop_ prefix", () => {
    const { tools } = harness(summary(), () => ({ ok: true, value: {} }))

    const names = tools.map((tool) => tool.name)
    expect(names).toContain("desktop_list_windows")
    expect(names).toContain("desktop_type_text")
    expect(names).not.toContain("computer_look")
    expect(names).not.toContain("computer_act")
    expect(names).not.toContain("list_windows")

    const typeText = tools.find((tool) => tool.name === "desktop_type_text")
    expect(typeText?.description).toBe("Type text into an element")
    const schema = typeText?.parameters as { properties: Record<string, { type: string }>; required: string[] }
    expect(schema.properties.text).toEqual({ type: "string" })
    expect(schema.properties.target).toEqual({ type: "object" })
    expect(schema.properties.pc?.type).toBe("string")
    expect(schema.required).toEqual(["target", "text"])
  })

  it("keeps the same list and schema byte for byte", () => {
    const first = harness(summary(), () => ({ ok: true, value: {} })).tools
    const second = harness(summary(), () => ({ ok: true, value: {} })).tools

    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it("routes a call to the daemon with cua's tool name and strips pc", async () => {
    const { tool, calls } = harness(summary(), () => ({
      ok: true,
      value: { content: [{ type: "text", text: "typed kiko" }] },
    }))

    const out = await tool("desktop_type_text").execute(
      { pc: "Mac", target: { kind: "window" }, text: "kiko" },
      api,
      context,
    )

    expect(calls).toEqual([
      {
        method: "desktop.call",
        params: { name: "type_text", args: { target: { kind: "window" }, text: "kiko" } },
      },
    ])
    expect(textOf(out)).toBe("typed kiko")
  })

  it("turns an image result into model image content", async () => {
    const { tool } = harness(
      summary(),
      () => ({
        ok: true,
        value: {
          content: [
            { type: "text", text: "the screen" },
            { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
          ],
        },
      }),
      DESKTOP,
      true,
    )

    const out = await tool("desktop_list_windows").execute({}, api, context)

    expect(out.output).toEqual([
      { type: "text", text: "the screen" },
      { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
    ])
  })

  it("base64-encodes the bytes of a binary image exactly once for the model", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0x00, 0x10])
    const { tool } = harness(
      summary(),
      () => ({
        ok: true,
        value: { content: [{ type: "image", data: bytes, mimeType: "image/jpeg" }] },
      }),
      DESKTOP,
      true,
    )

    const out = await tool("desktop_list_windows").execute({}, api, context)
    const part = out.output?.[1] as { type: string; data: string; mimeType: string }

    expect(part).toEqual({ type: "image", data: btoa(String.fromCharCode(...bytes)), mimeType: "image/jpeg" })
  })

  it("keeps a tool's own error flag", async () => {
    const { tool } = harness(summary(), () => ({
      ok: true,
      value: { content: [{ type: "text", text: "no such window" }], isError: true },
    }))

    const out = await tool("desktop_list_windows").execute({}, api, context)

    expect(out.isError).toBe(true)
    expect(textOf(out)).toBe("no such window")
  })

  it("reports a failed call with the computer's name", async () => {
    const { tool } = harness(summary(), () => ({ ok: false, code: "unsupported", message: "it is asleep" }))

    const out = await tool("desktop_list_windows").execute({}, api, context)

    expect(out.isError).toBe(true)
    expect(textOf(out)).toBe("Mac cannot do this: it is asleep")
  })

  it("builds no desktop tools when the daemon has none", () => {
    const { tools } = harness(summary(), () => ({ ok: true, value: {} }), [])

    expect(tools.map((tool) => tool.name)).not.toContain("desktop_list_windows")
  })
})

describe("browser_tabs", () => {
  it("groups tabs by browser and names each browser's state", async () => {
    const pc = summary({
      browsers: [
        { name: "chrome", state: "connected" },
        { name: "edge", state: "needs_consent" },
      ],
    })
    const { tool } = harness(pc, () => ({ ok: true, value: [TAB] }))

    const out = await tool("browser_tabs").execute({}, api, context)

    expect(textOf(out)).toContain("Chrome:")
    expect(textOf(out)).toContain("t-1 [in front] Inbox — https://mail.example/")
    expect(textOf(out)).toContain(
      'Edge: open edge://inspect in Edge and turn on "Allow remote debugging for this browser instance"',
    )
  })
})

describe("browser_read", () => {
  it("reads a tab in the background", async () => {
    const { tool, calls } = harness(summary(), () => ({ ok: true, value: PAGE }))

    const out = await tool("browser_read").execute({ tab: "t-1" }, api, context)

    expect(calls).toEqual([{ method: "browser.read", params: { tab: "t-1", image: false, max_width: 960 } }])
    expect(textOf(out)).toContain("Inbox — https://mail.example/ (tab t-1, read in the background)")
    expect(textOf(out)).toContain('[2] link "Compose"')
  })

  it("uses the page image bytes a binary result carried", async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const { tool } = harness(
      summary(),
      () => ({
        ok: true,
        value: {
          ...PAGE,
          image: { mime: "image/png", data: bytes, width: 4, height: 4, covers: { x: 0, y: 0, w: 1, h: 1 } },
        },
      }),
      DESKTOP,
      true,
    )

    const out = await tool("browser_read").execute({ tab: "t-1", image: true }, api, context)

    expect(out.output?.[1]).toEqual({ type: "image", data: "AQID", mimeType: "image/png" })
  })
})

describe("browser_act", () => {
  const steps = [
    { action: "type", ref: 3, text: "ada" },
    { action: "click", ref: 2 },
  ]

  it("runs every step in one call and reads the page after them", async () => {
    const { tool, batches, calls } = harness(summary(), () => ({ ok: true, value: {} }))

    const out = await tool("browser_act").execute({ tab: "t-1", steps: [...steps] }, api, context)

    expect(batches).toEqual([
      {
        tab: "t-1",
        steps: [...steps],
        read: true,
        image: false,
        max_width: 960,
        mode: "background",
      },
    ])
    expect(calls).toEqual([])
    expect(out.isError).toBe(false)
    expect(textOf(out)).toContain("did 2 of 2 steps on Inbox — https://mail.example/ (tab t-1, read in the background)")
    expect(textOf(out)).toContain('[2] link "Compose"')
  })

  it("says which step failed and still shows the page", async () => {
    const { tool } = harness(
      summary(),
      () => ({ ok: true, value: PAGE }),
      DESKTOP,
      false,
      (args) => ({
        ok: true,
        value: {
          done: 1,
          failed: { index: 1, code: "stale", error: "that ref is stale; read the page again" },
          page: PAGE,
        },
      }),
    )

    const out = await tool("browser_act").execute({ tab: "t-1", steps: [...steps] }, api, context)

    expect(out.isError).toBe(true)
    expect(textOf(out)).toContain("did 1 of 2 steps on Inbox")
    expect(textOf(out)).toContain("step 2 failed: that id is from an old view; read the page again")
  })

  it("stops and tells the model to wait when the owner takes over", async () => {
    const { tool } = harness(
      summary(),
      () => ({ ok: true, value: PAGE }),
      DESKTOP,
      false,
      () => ({ ok: true, value: { done: 1, stoppedBy: "owner" } }),
    )

    const out = await tool("browser_act").execute({ tab: "t-1", steps: [...steps] }, api, context)

    expect(out.isError).toBe(true)
    expect(textOf(out)).toContain("did 1 of 2 steps on Mac, then the owner took control of it")
  })

  it("refuses a ref that is not a whole number without doing anything", async () => {
    const { tool, batches } = harness(summary(), () => ({ ok: true, value: {} }))

    const out = await tool("browser_act").execute({ tab: "t-1", steps: [{ action: "click", ref: 1.5 }] }, api, context)

    expect(out.isError).toBe(true)
    expect(textOf(out)).toContain("step 1: ref must be a whole number from browser_read. nothing was done.")
    expect(batches).toEqual([])
  })

  it("asks the owner to update the app when it cannot run steps", async () => {
    const { tool, batches } = harness({ ...summary(), caps: { ...summary().caps, steps: undefined } }, () => ({
      ok: true,
      value: {},
    }))

    const out = await tool("browser_act").execute({ tab: "t-1", steps: [...steps] }, api, context)

    expect(out.isError).toBe(true)
    expect(textOf(out)).toContain("runs a kiko app that cannot run browser steps in one call; update the app on it.")
    expect(batches).toEqual([])
  })
})

describe("browser_open", () => {
  it("returns the new tab's line", async () => {
    const { tool } = harness(summary(), () => ({ ok: true, value: TAB }))

    const out = await tool("browser_open").execute({ url: "https://mail.example/" }, api, context)

    expect(textOf(out)).toContain("t-1 [in front] Inbox — https://mail.example/")
  })
})

describe("browser gate", () => {
  it("gives the consent steps when a browser needs remote debugging", async () => {
    const pc = summary({
      caps: { ...summary().caps, browser: false },
      browsers: [{ name: "chrome", state: "needs_consent" }],
    })
    const { tool } = harness(pc, () => ({ ok: true, value: [] }))

    const out = await tool("browser_tabs").execute({}, api, context)

    expect(out.isError).toBe(true)
    expect(textOf(out)).toContain(
      'open chrome://inspect/#remote-debugging in Chrome and turn on "Allow remote debugging for this browser instance"',
    )
  })

  it("does not need the screen permission for the browser tools", async () => {
    const pc = summary({ background: false })
    const { tool, calls } = harness(pc, () => ({ ok: true, value: [TAB] }))

    const out = await tool("browser_tabs").execute({}, api, context)

    expect(calls).toEqual([{ method: "browser.tabs" }])
    expect(out.isError).toBeFalsy()
  })
})

describe("browser_close and browser_show", () => {
  it("closes a tab", async () => {
    const { tool, calls } = harness(summary(), () => ({ ok: true, value: null }))

    const out = await tool("browser_close").execute({ tab: "t-1" }, api, context)

    expect(calls).toEqual([{ method: "browser.close", params: { tab: "t-1" } }])
    expect(textOf(out)).toBe("closed tab t-1 on Mac.")
  })

  it("brings a tab to the front when the owner asks", async () => {
    const { tool, calls } = harness(summary(), () => ({ ok: true, value: null }))

    const out = await tool("browser_show").execute({ tab: "t-1" }, api, context)

    expect(calls).toEqual([{ method: "browser.show", params: { tab: "t-1" } }])
    expect(textOf(out)).toBe("brought tab t-1 to the front on Mac.")
  })
})
