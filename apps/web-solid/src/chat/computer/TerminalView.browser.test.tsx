import type { TerminalEvent } from "@kiko/protocol"
import { createSignal } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { render, type Screen } from "../../../test/render"
import TerminalView from "./TerminalView"

type FakeView = {
  inputs: string[]
  resizes: [number, number][]
  closed: boolean
  emit(event: TerminalEvent): void
  status(status: "live" | "ended" | "error", message?: string): void
}

const fakes = vi.hoisted(() => ({
  views: [] as FakeView[],
}))

vi.mock("../computers", () => ({ takePending: () => false }))

vi.mock("./terminalSession", () => ({
  startTerminal: (
    _pcId: string,
    _terminalId: string,
    hooks: { onEvent(event: TerminalEvent): void; onStatus(status: string, message?: string): void },
  ) => {
    const view: FakeView = {
      inputs: [],
      resizes: [],
      closed: false,
      emit: (event) => hooks.onEvent(event),
      status: (status, message) => hooks.onStatus(status, message),
    }
    fakes.views.push(view)
    queueMicrotask(() => {
      view.status("live")
      view.emit({
        type: "snapshot",
        history: "\x1b[?2004h$ ",
        cols: 80,
        rows: 24,
        status: "running",
        exitCode: null,
      })
    })
    return {
      input: (data: string) => {
        view.inputs.push(data)
        view.emit({ type: "output", data: data.replaceAll("\x1b[200~", "").replaceAll("\x1b[201~", "") })
      },
      resize: (cols: number, rows: number) => view.resizes.push([cols, rows]),
      close: () => {
        view.closed = true
      },
    }
  },
}))

const view = () => fakes.views.at(-1) as FakeView

const rows = (screen: Screen): string => screen.container.querySelector(".xterm-rows")?.textContent ?? ""

const textarea = (screen: Screen): HTMLTextAreaElement =>
  screen.container.querySelector(".xterm-helper-textarea") as HTMLTextAreaElement

const KEY_CODES: Record<string, number> = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8 }

const typeKey = (screen: Screen, key: string, code: string) => {
  const event = new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true })
  const keyCode = KEY_CODES[key] ?? key.toUpperCase().charCodeAt(0)
  Object.defineProperty(event, "keyCode", { get: () => keyCode })
  textarea(screen).dispatchEvent(event)
}

const paste = (screen: Screen, text: string) => {
  const data = new DataTransfer()
  data.setData("text/plain", text)
  textarea(screen).dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }))
}

async function mount(interactive: () => boolean) {
  const container = document.createElement("div")
  container.style.cssText = "width:800px;height:500px"
  fakes.views = []
  const screen = await render(() => <TerminalView pcId="pc-1" terminalId="t-1" interactive={interactive()} />, {
    container,
  })
  await expect.poll(() => rows(screen)).toContain("$")
  return screen
}

describe("terminal view", () => {
  it("attaches, paints the snapshot, and then paints live output", async () => {
    await using screen = await mount(() => false)

    view().emit({ type: "output", data: "ready\r\n" })

    await expect.poll(() => rows(screen)).toContain("ready")
    expect(view().resizes.length).toBeGreaterThan(0)
  })

  it("types into the shell once the owner has control", async () => {
    await using screen = await mount(() => true)

    typeKey(screen, "l", "KeyL")
    typeKey(screen, "s", "KeyS")

    await expect.poll(() => view().inputs.join("")).toBe("ls")
    await expect.poll(() => rows(screen)).toContain("ls")
  })

  it("sends a three line paste as one bracketed paste", async () => {
    await using screen = await mount(() => true)

    paste(screen, "one\ntwo\nthree")

    await expect.poll(() => view().inputs).toEqual(["\x1b[200~one\rtwo\rthree\x1b[201~"])
  })

  it("sends nothing while watching, and lets the agent type again after a release", async () => {
    const [control, setControl] = createSignal(false)
    await using screen = await mount(() => control())

    typeKey(screen, "x", "KeyX")
    expect(view().inputs).toEqual([])

    setControl(true)
    typeKey(screen, "x", "KeyX")
    await expect.poll(() => view().inputs).toEqual(["x"])

    const agentSend = (text: string) => {
      if (control()) throw new Error("the owner has control of this terminal")
      view().emit({ type: "output", data: text })
    }

    expect(() => agentSend("agent: blocked\r\n")).toThrow(/owner has control/)

    setControl(false)
    typeKey(screen, "y", "KeyY")
    expect(view().inputs).toEqual(["x"])

    agentSend("agent: hi\r\n")
    await expect.poll(() => rows(screen)).toContain("agent: hi")
  })
})
