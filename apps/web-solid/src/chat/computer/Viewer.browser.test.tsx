import type { ComputerSummary, TerminalEvent, TerminalSummary } from "@kiko/protocol"
import { describe, expect, it, vi } from "vitest"
import { render } from "../../../test/render"
import { openViewer, startComputers } from "../computers"
import Viewer from "./Viewer"

const backend = vi.hoisted(() => ({
  calls: [] as string[],
  terminals: [] as TerminalSummary[],
  inputs: [] as string[],
}))

const signals = vi.hoisted(() => ({ handlers: {} as Record<string, (signal: unknown) => void> }))

vi.mock("../../state/runtime", () => ({
  run: async (command: string) => {
    backend.calls.push(command)
    return { _tag: "Success", value: command === "terminal.list" ? backend.terminals : undefined }
  },
  failureMessage: () => "",
  owner: {
    commands: {
      pcList: "pc.list",
      pcTake: "pc.take",
      pcRelease: "pc.release",
      pcRename: "pc.rename",
      pcRemove: "pc.remove",
      pcPairCode: "pc.pairCode",
      terminalList: "terminal.list",
      terminalOpen: "terminal.open",
    },
  },
  observe: () => () => {},
  valueOf: (value: unknown) => value,
}))

vi.mock("../../state/user", () => ({
  user: { agents: () => [] },
  onUserSignal: (tag: string, handler: (signal: unknown) => void) => {
    signals.handlers[tag] = handler
    return () => {}
  },
}))

vi.mock("./terminalSession", () => ({
  startTerminal: (
    _pcId: string,
    _terminalId: string,
    hooks: { onEvent(event: TerminalEvent): void; onStatus(status: string, message?: string): void },
  ) => {
    queueMicrotask(() => {
      hooks.onStatus("live")
      hooks.onEvent({
        type: "snapshot",
        history: "\x1b[?2004h$ ",
        cols: 80,
        rows: 24,
        status: "running",
        exitCode: null,
      })
    })
    return {
      input: (data: string) => backend.inputs.push(data),
      resize: () => {},
      close: () => {},
    }
  },
}))

vi.mock("./LiveScreen", () => ({ default: () => <div data-part="fake-screen" /> }))

const computer = (holder: "agent" | "human"): ComputerSummary => ({
  id: "pc-1",
  name: "Mac",
  os: "macos",
  online: true,
  caps: { shell: true, files: true, desktop: true, live: true, input: true, terminal: true },
  holder,
  ...(holder === "human" ? { heldBy: "you" as const } : {}),
  displays: [{ id: "primary", width: 1512, height: 982, scale: 1 }],
  access: { screen: true, input: true },
  background: false,
  browsers: [],
})

const typeKey = (container: HTMLElement, key: string, code: string) => {
  const textarea = container.querySelector(".xterm-helper-textarea") as HTMLTextAreaElement
  const event = new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true })
  Object.defineProperty(event, "keyCode", { get: () => key.toUpperCase().charCodeAt(0) })
  textarea.dispatchEvent(event)
}

describe("computer viewer", () => {
  it("lists the agent's terminals and types into one after taking over", async () => {
    backend.calls = []
    backend.terminals = [
      {
        id: "t-1",
        name: "zsh 1",
        cwd: "/home/me",
        shell: "/bin/zsh",
        cols: 120,
        rows: 30,
        status: "running",
        exitCode: null,
      },
    ]
    startComputers()
    signals.handlers.pcState?.({ t: "pcState", computers: [computer("agent")] })
    openViewer("pc-1")
    await using screen = await render(() => <Viewer />)

    await expect.element(screen.getByText("zsh 1")).toBeVisible()
    await screen.getByText("zsh 1").click()
    await expect.poll(() => screen.container.querySelector(".xterm-rows")?.textContent ?? "").toContain("$")

    typeKey(screen.container, "l", "KeyL")
    expect(backend.inputs).toEqual([])

    await screen.getByText("Take over").click()

    await expect.poll(() => backend.calls).toContain("pc.take")
    typeKey(screen.container, "l", "KeyL")
    await expect.poll(() => backend.inputs).toEqual(["l"])
  })
})
