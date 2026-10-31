import { execFileSync } from "node:child_process"
import { join } from "node:path"
import type { DriverCall } from "@kiko/computer/driver"
import type { Driver } from "@kiko/computer-daemon/src/driver.ts"
import { TerminalManager } from "@kiko/computer-daemon/src/terminal/manager.ts"
import type { PtyInput } from "@kiko/computer-daemon/src/terminal/pty.ts"
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

const COMPUTER_NAMES = ["computer_shell", "computer_read", "computer_write"]

const TERMINAL_NAMES = [
  "terminal_open",
  "terminal_send",
  "terminal_read",
  "terminal_wait",
  "terminal_list",
  "terminal_close",
]

function serverTools(): ToolSpec[] {
  const script = [
    `const { computerExtension } = await import(${JSON.stringify(serverToolsPath)})`,
    `const extension = computerExtension({ port: () => { throw new Error("no port") }, acceptsImages: () => true, desktop: [] })`,
    `console.log(JSON.stringify(extension.tools.map(({ name, description, parameters }) => ({ name, description, parameters }))))`,
  ].join("\n")
  return JSON.parse(execFileSync("bun", ["-e", script], { encoding: "utf8" })) as ToolSpec[]
}

const byName = (tools: readonly ToolSpec[], names: readonly string[]): ToolSpec[] =>
  tools.filter((tool) => names.includes(tool.name))

function harness(): { manager: TerminalManager; writes: string[]; emit(text: string): void } {
  const writes: string[] = []
  let input: PtyInput | undefined
  const manager = new TerminalManager({
    spawn: (created) => {
      input = created
      return {
        pid: 4242,
        write: (data) => writes.push(data),
        resize: () => undefined,
        kill: () => undefined,
        close: () => undefined,
        exited: new Promise<number | null>(() => undefined),
      }
    },
    screen: () => {
      let value = ""
      return {
        write: (text, done) => {
          value += text
          done?.()
        },
        text: () => value,
        resize: () => undefined,
        dispose: () => undefined,
      }
    },
  })
  return { manager, writes, emit: (text) => input?.onData(new TextEncoder().encode(text)) }
}

describe("kiko tool schemas", () => {
  it("matches the server's name, description and parameters", () => {
    const wanted = new Set(KIKO_TOOLS.map((tool) => tool.name))
    const fromServer = serverTools().filter((tool) => wanted.has(tool.name))
    expect(fromServer).toEqual([...KIKO_TOOLS])
  })

  it("carries every computer and terminal tool the server offers", () => {
    expect(byName(serverTools(), COMPUTER_NAMES).map((tool) => tool.name)).toEqual(COMPUTER_NAMES)
    expect(byName(serverTools(), TERMINAL_NAMES).map((tool) => tool.name)).toEqual(TERMINAL_NAMES)
    expect(byName(KIKO_TOOLS, COMPUTER_NAMES).map((tool) => tool.name)).toEqual(COMPUTER_NAMES)
    expect(byName(KIKO_TOOLS, TERMINAL_NAMES).map((tool) => tool.name)).toEqual(TERMINAL_NAMES)
  })

  it("offers the shell, file and terminal tools without a driver", async () => {
    const machine = await createMachine("test-kiko")
    machines.push(machine)
    const contender = kikoContender()
    await contender.start(machine, "foreground")
    expect(contender.tools().map((tool) => tool.name)).toEqual([
      "computer_shell",
      "computer_read",
      "computer_write",
      ...TERMINAL_NAMES,
    ])
    await contender.stop()
  })

  it("runs terminal sessions through the real terminal manager", async () => {
    const machine = await createMachine("test-kiko")
    machines.push(machine)
    const { manager, writes, emit } = harness()
    const contender = kikoContender({ terminals: manager })
    await contender.start(machine, "foreground")
    const signal = new AbortController().signal
    const opened = await contender.call("terminal_open", { name: "repl" }, signal)
    expect(opened.isError).toBe(false)
    const id = /opened repl \((.+)\) running/.exec(opened.text)?.[1] ?? ""
    expect(id).not.toBe("")
    const sent = await contender.call("terminal_send", { id, text: "echo hi", keys: ["enter"] }, signal)
    expect(sent.isError).toBe(false)
    expect(writes).toEqual(["echo hi\r"])
    emit("hi\r\n")
    const read = await contender.call("terminal_read", { id, mode: "tail" }, signal)
    expect(read.isError).toBe(false)
    expect(read.text).toContain("hi")
    const waited = await contender.call("terminal_wait", { id, until: "hi" }, signal)
    expect(waited.text).toContain("found")
    const listed = await contender.call("terminal_list", {}, signal)
    expect(listed.text).toContain("repl")
    expect(listed.text).toContain(id)
    const closed = await contender.call("terminal_close", { id }, signal)
    expect(closed.text).toContain("closed")
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
      ...TERMINAL_NAMES,
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
})
