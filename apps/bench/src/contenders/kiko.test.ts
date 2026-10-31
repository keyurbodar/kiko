import { execFileSync } from "node:child_process"
import { join } from "node:path"
import type { DriverCall, Look, Window } from "@kiko/computer/driver"
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
    `const extension = computerExtension({ port: () => { throw new Error("no port") }, acceptsImages: () => true })`,
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

  it("offers the shell and file tools without a driver", async () => {
    const machine = await createMachine("test-kiko")
    machines.push(machine)
    const contender = kikoContender()
    await contender.start(machine, "foreground")
    expect(contender.tools().map((tool) => tool.name)).toEqual(["computer_shell", "computer_read", "computer_write"])
    await contender.stop()
  })

  it("reads and writes files in the trial workdir", async () => {
    const machine = await createMachine("test-kiko")
    machines.push(machine)
    const contender = kikoContender()
    await contender.start(machine, "foreground")
    const path = join(machine.workdir, "notes.txt")
    const written = await contender.call("computer_write", { path, text: "hello\n" }, new AbortController().signal)
    expect(written.isError).toBe(false)
    expect(written.text).toContain("6 bytes")
    const read = await contender.call("computer_read", { path }, new AbortController().signal)
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

  it("uses the kiko driver for background windows when one is connected", async () => {
    const machine = await createMachine("test-kiko")
    machines.push(machine)
    const calls: DriverCall[] = []
    const window: Window = {
      id: "7",
      pid: 12,
      app: "Files",
      title: "Home",
      frame: { x: 0, y: 0, w: 800, h: 600 },
      focused: true,
      minimized: false,
      on_screen: true,
    }
    const look: Look = {
      window,
      image: { mime: "image/png", data: "aGk=", width: 800, height: 600, covers: { x: 0, y: 0, w: 800, h: 600 } },
      nodes: [],
      outline: '0 button "Open"',
    }
    const driver: Driver = {
      call: async (call) => {
        calls.push(call)
        if (call.method === "windows") return [window]
        if (call.method === "look") return look
        return { route: "background" }
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
      "computer_windows",
      "computer_see",
      "computer_use",
    ])
    const windows = await contender.call("computer_windows", {}, new AbortController().signal)
    expect(windows.isError).toBe(false)
    expect(windows.text).toContain("Files — Home")
    const seen = await contender.call("computer_see", { window: "7" }, new AbortController().signal)
    expect(seen.images).toHaveLength(1)
    expect(seen.text).toContain("Open")
    const used = await contender.call(
      "computer_use",
      { window: "7", steps: [{ action: "press", ref: 0 }] },
      new AbortController().signal,
    )
    expect(used.isError).toBe(false)
    expect(used.text).toContain("did all 1 steps")
    const act = calls.find((call) => call.method === "act")
    if (act?.method !== "act") throw new Error("the contender did not call act")
    expect(act.params).toMatchObject({ window: "7", action: "press", mode: "background", ref: 0 })
    await contender.stop()
  })
})
