import { execFileSync } from "node:child_process"
import { join } from "node:path"
import type { DriverCall } from "@kiko/computer/driver"
import type { Driver } from "@kiko/computer-daemon/src/driver.ts"
import { afterEach, describe, expect, it } from "vitest"
import { createMachine, removeMachine } from "../machine"
import type { Machine, ToolSpec } from "../types"
import { kikoContender } from "./kiko"
import { KIKO_TOOLS } from "./kiko-schemas"

const machines: Machine[] = []

afterEach(async () => {
  await Promise.all(machines.splice(0).map((machine) => removeMachine(machine)))
})

const serverToolsPath = join(import.meta.dirname, "../../../server/src/agent/computer/tools.ts")

function serverTools(): ToolSpec[] {
  const script = [
    `const { computerExtension } = await import(${JSON.stringify(serverToolsPath)})`,
    `const extension = computerExtension({ port: () => { throw new Error("no port") }, acceptsImages: () => true, desktop: [] })`,
    `console.log(JSON.stringify(extension.tools.map(({ name, description, parameters }) => ({ name, description, parameters }))))`,
  ].join("\n")
  return JSON.parse(execFileSync("bun", ["-e", script], { encoding: "utf8" })) as ToolSpec[]
}

describe("kiko tool schemas", () => {
  it("matches the server's name, description and parameters", () => {
    const wanted = new Set(KIKO_TOOLS.map((tool) => tool.name))
    const fromServer = serverTools().filter((tool) => wanted.has(tool.name))
    expect(fromServer).toEqual([...KIKO_TOOLS])
  })

  it("offers the shell, file and browser tools without a driver", async () => {
    const machine = await createMachine("test-kiko")
    machines.push(machine)
    const contender = kikoContender()
    await contender.start(machine, "foreground")
    expect(contender.tools().map((tool) => tool.name)).toEqual([
      "computer_shell",
      "computer_read",
      "computer_write",
      "browser_tabs",
      "browser_read",
      "browser_act",
      "browser_open",
      "browser_close",
      "browser_show",
    ])
    await contender.stop()
  })

  it("reads and writes files in the trial workdir", async () => {
    const machine = await createMachine("test-kiko")
    machines.push(machine)
    const contender = kikoContender()
    await contender.start(machine, "foreground")
    const written = await contender.call(
      "computer_write",
      { path: "notes.txt", text: "hello\n" },
      new AbortController().signal,
    )
    expect(written.isError).toBe(false)
    expect(written.text).toContain("6 bytes")
    const read = await contender.call("computer_read", { path: "notes.txt" }, new AbortController().signal)
    expect(read.isError).toBe(false)
    expect(read.text).toContain("hello")
    const outside = await contender.call(
      "computer_read",
      { path: join(import.meta.dirname, "kiko.ts") },
      new AbortController().signal,
    )
    expect(outside.isError).toBe(true)
    await contender.stop()
  })

  it("lists and calls the desktop tools the driver reports", async () => {
    const machine = await createMachine("test-kiko")
    machines.push(machine)
    const calls: DriverCall[] = []
    const tools = [
      { name: "list_windows", description: "List top-level windows", inputSchema: { type: "object", properties: {} } },
      {
        name: "get_window_state",
        description: "Snapshot a window",
        inputSchema: { type: "object", properties: { window_id: { type: "integer" } }, required: ["window_id"] },
      },
    ]
    const driver: Driver = {
      call: async (call) => {
        calls.push(call)
        if (call.method === "desktop.tools") return { version: "0.38.0", tools }
        if (call.method === "desktop.call") {
          if (call.params.name === "list_windows") return { content: [{ type: "text", text: "0 window [id=7]" }] }
          return {
            content: [
              { type: "text", text: "window 7: Files" },
              { type: "image", data: "aGk=", mimeType: "image/png" },
            ],
          }
        }
        return {}
      },
      state: () => null,
      background: () => true,
      browser: () => false,
      close: () => undefined,
    }
    const contender = kikoContender({ driver })
    await contender.start(machine, "foreground")
    expect(contender.tools().map((tool) => tool.name)).toEqual([
      "computer_shell",
      "computer_read",
      "computer_write",
      "browser_tabs",
      "browser_read",
      "browser_act",
      "browser_open",
      "browser_close",
      "browser_show",
      "desktop_list_windows",
      "desktop_get_window_state",
    ])
    const listed = contender.tools().find((tool) => tool.name === "desktop_get_window_state")
    expect(listed?.description).toBe("Snapshot a window")
    expect(listed?.parameters).toMatchObject({
      required: ["window_id"],
      properties: { window_id: { type: "integer" }, pc: { type: "string" } },
    })

    const windows = await contender.call("desktop_list_windows", {}, new AbortController().signal)
    expect(windows.isError).toBe(false)
    expect(windows.text).toContain("id=7")

    const seen = await contender.call(
      "desktop_get_window_state",
      { window_id: 7, pc: "ignored" },
      new AbortController().signal,
    )
    expect(seen.text).toContain("Files")
    expect(seen.images).toEqual([{ mime: "image/png", base64: "aGk=" }])

    const called = calls.find((call) => call.method === "desktop.call" && call.params.name === "get_window_state")
    expect(called).toMatchObject({ params: { name: "get_window_state", args: { window_id: 7 } } })
    await contender.stop()
  })

  it("runs a browser batch through the driver and reads the page after it", async () => {
    const machine = await createMachine("test-kiko")
    machines.push(machine)
    const calls: DriverCall[] = []
    const page = {
      tab: {
        id: "t-1",
        browser: "agent-browser",
        window_id: 0,
        index: 0,
        active: true,
        title: "Inbox",
        url: "https://mail.example/",
      },
      nodes: [],
      outline: '[2] link "Compose"',
    }
    const driver: Driver = {
      call: async (call) => {
        calls.push(call)
        return call.method === "browser.read" ? page : {}
      },
      state: () => null,
      background: () => true,
      browser: () => true,
      close: () => undefined,
    }
    const contender = kikoContender({ driver })
    await contender.start(machine, "foreground")
    const out = await contender.call(
      "browser_act",
      {
        tab: "t-1",
        steps: [
          { action: "type", ref: 3, text: "ada" },
          { action: "click", ref: 2 },
        ],
      },
      new AbortController().signal,
    )
    expect(out.isError).toBe(false)
    expect(out.text).toContain("did 2 of 2 steps on Inbox — https://mail.example/ (tab t-1, read in the background)")
    expect(calls.filter((call) => call.method === "browser.act")).toHaveLength(2)
    expect(calls.at(-1)?.method).toBe("browser.read")
    await contender.stop()
  })
})
