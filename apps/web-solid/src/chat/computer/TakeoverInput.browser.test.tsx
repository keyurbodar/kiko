import type { ComputerSummary } from "@kiko/protocol"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { userEvent } from "vitest/browser"
import { render } from "../../../test/render"
import LiveScreen from "./LiveScreen"

beforeAll(() => {
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
})

type Sent = {
  k?: string
  code?: string
  key?: string
  down?: boolean
  s?: string
  mods?: number
  x?: number
  y?: number
}

const fakes = vi.hoisted(() => ({
  computer: undefined as ComputerSummary | undefined,
  sent: [] as Sent[][],
  picks: [] as string[],
  hooks: undefined as
    | {
        onClipboard(text: string): void
        onCursor(cursor: { x: number; y: number } | null): void
        onMode(mode: string): void
      }
    | undefined,
}))

vi.mock("../computers", () => ({
  computerById: () => fakes.computer,
  takePending: () => false,
}))

vi.mock("./session", () => ({
  startSession: (_pcId: string, hooks: NonNullable<typeof fakes.hooks>) => {
    fakes.hooks = hooks
    return {
      close: () => {},
      send: (events: Sent[]) => fakes.sent.push(events),
      pick: (id: string) => fakes.picks.push(id),
    }
  },
}))

const mac = (extra: Partial<ComputerSummary> = {}): ComputerSummary =>
  ({
    id: "pc-1",
    name: "Mac",
    os: "macos",
    online: true,
    caps: { shell: true, files: true, desktop: true, live: true, input: true },
    holder: "human",
    heldBy: "you",
    displays: [{ id: "primary", width: 1512, height: 982, scale: 2 }],
    access: { screen: true, input: true },
    ...extra,
  }) as unknown as ComputerSummary

function mount(interactive: boolean) {
  return render(() => (
    <div style={{ width: "800px", height: "600px" }}>
      <LiveScreen pcId="pc-1" interactive={interactive} />
    </div>
  ))
}

function sink(screen: { container: HTMLElement }): HTMLTextAreaElement {
  const found = screen.container.querySelector<HTMLTextAreaElement>('[data-part="sink"]')
  if (!found) throw new Error("the screen has no keyboard sink")
  return found
}

function clipboardStub(first: "resolve" | "reject") {
  const writeText = vi.fn(() => (first === "reject" ? Promise.reject(new Error("no gesture")) : Promise.resolve()))
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
  return writeText
}

describe("typing into the computer", () => {
  it("commits a composed word once, as text, and sends no raw keystrokes", async () => {
    fakes.computer = mac()
    fakes.sent = []
    await using screen = await mount(true)
    const input = sink(screen)
    input.focus()

    input.dispatchEvent(new CompositionEvent("compositionstart", { data: "", bubbles: true }))
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Process", code: "KeyN", bubbles: true, isComposing: true }),
    )
    input.dispatchEvent(new CompositionEvent("compositionupdate", { data: "に", bubbles: true }))
    input.dispatchEvent(
      new InputEvent("beforeinput", {
        inputType: "insertCompositionText",
        data: "に",
        isComposing: true,
        bubbles: true,
      }),
    )
    input.dispatchEvent(new CompositionEvent("compositionend", { data: "こんにちは", bubbles: true }))

    expect(fakes.sent.flat()).toEqual([{ k: "text", s: "こんにちは" }])
  })

  it("sends a dead key's committed character as text, not as a keystroke", async () => {
    fakes.computer = mac()
    fakes.sent = []
    await using screen = await mount(true)
    const input = sink(screen)
    input.focus()

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Dead", code: "Backquote", bubbles: true }))
    input.dispatchEvent(new CompositionEvent("compositionstart", { data: "", bubbles: true }))
    input.dispatchEvent(new CompositionEvent("compositionend", { data: "é", bubbles: true }))

    expect(fakes.sent.flat()).toEqual([{ k: "text", s: "é" }])
  })

  it("still sends shortcuts as keys while text goes as text", async () => {
    fakes.computer = mac()
    fakes.sent = []
    await using screen = await mount(true)
    const input = sink(screen)
    input.focus()

    await userEvent.keyboard("{Meta>}c{/Meta}")

    expect(fakes.sent.flat().map((event) => `${event.k}:${event.code}:${event.down}`)).toEqual([
      "key:MetaLeft:true",
      "key:KeyC:true",
      "key:KeyC:false",
      "key:MetaLeft:false",
    ])
  })
})

describe("pasting into the computer", () => {
  it("sends one paste event carrying the text and the remote chord", async () => {
    fakes.computer = mac()
    fakes.sent = []
    await using screen = await mount(true)
    const input = sink(screen)
    input.focus()

    const data = new DataTransfer()
    data.setData("text/plain", "héllo\nwörld — こんにちは")
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }))

    expect(fakes.sent).toEqual([[{ k: "paste", s: "héllo\nwörld — こんにちは", code: "KeyV", mods: 8 }]])
  })

  it("carries ten kilobytes of text as one paste", async () => {
    fakes.computer = mac()
    fakes.sent = []
    await using screen = await mount(true)
    const input = sink(screen)
    input.focus()
    const big = "abc日本語🎉\n".repeat(600)

    const data = new DataTransfer()
    data.setData("text/plain", big)
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }))

    expect(fakes.sent).toEqual([[{ k: "paste", s: big, code: "KeyV", mods: 8 }]])
    expect(fakes.sent.flat()[0]?.s).toHaveLength(big.length)
  })

  it("uses Ctrl on a Linux computer and never types the text out", async () => {
    fakes.computer = mac({ os: "linux" })
    fakes.sent = []
    await using screen = await mount(true)
    const input = sink(screen)
    input.focus()

    const data = new DataTransfer()
    data.setData("text/plain", "two\nlines")
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }))

    expect(fakes.sent.flat()).toEqual([{ k: "paste", s: "two\nlines", code: "KeyV", mods: 2 }])
  })
})

describe("copying from the computer", () => {
  it("offers the computer's clipboard again on the next gesture", async () => {
    fakes.computer = mac()
    const writeText = clipboardStub("reject")
    await using screen = await mount(true)
    const stage = screen.container.querySelector('[data-part="stage"]')
    expect(stage).not.toBeNull()

    fakes.hooks?.onClipboard("copied on the Mac")
    await expect.poll(() => writeText.mock.calls.length).toBe(1)
    expect(writeText).toHaveBeenLastCalledWith("copied on the Mac")

    stage?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 20, clientY: 20 }))
    await expect.poll(() => writeText.mock.calls.length).toBe(2)
    expect(writeText).toHaveBeenLastCalledWith("copied on the Mac")
  })

  it("does nothing while the agent holds the computer", async () => {
    fakes.computer = mac()
    const writeText = clipboardStub("resolve")
    await using screen = await mount(false)
    const stage = screen.container.querySelector('[data-part="stage"]')

    fakes.hooks?.onClipboard("the agent's clipboard")
    stage?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }))
    await Promise.resolve()

    expect(writeText).not.toHaveBeenCalled()
  })
})

describe("choosing a display", () => {
  const two = () =>
    mac({
      displays: [
        { id: "left", width: 1000, height: 800, scale: 1, originX: 0, originY: 0 },
        { id: "right", width: 800, height: 600, scale: 1, originX: 1000, originY: 0 },
      ],
    })

  it("lists the displays and watches the one the owner picks", async () => {
    fakes.computer = two()
    fakes.picks = []
    fakes.sent = []
    await using screen = await mount(true)
    const picker = screen.container.querySelector<HTMLSelectElement>('[data-part="display-picker"]')
    expect(picker).not.toBeNull()
    expect([...(picker?.options ?? [])].map((option) => option.textContent)).toEqual([
      "Display 1 · 1000×800",
      "Display 2 · 800×600",
    ])
    const stage = screen.container.querySelector('[data-part="stage"]')
    expect(stage?.getAttribute("style")).toContain("1.25")

    if (picker) {
      picker.value = "right"
      picker.dispatchEvent(new Event("change", { bubbles: true }))
    }

    expect(fakes.picks).toEqual(["right"])
    expect(stage?.getAttribute("style")).toContain("1.333")
  })

  it("maps a click to the picked display's own coordinates", async () => {
    fakes.computer = two()
    fakes.sent = []
    await using screen = await mount(true)
    const picker = screen.container.querySelector<HTMLSelectElement>('[data-part="display-picker"]')
    const stage = screen.container.querySelector<HTMLElement>('[data-part="stage"]')
    expect(stage).not.toBeNull()
    const rect = { left: 100, top: 50, width: 800, height: 600, right: 900, bottom: 650, x: 100, y: 50 }
    if (stage) stage.getBoundingClientRect = () => rect as DOMRect

    stage?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 900, clientY: 650 }))
    const first = fakes.sent.flat().find((event) => event.k === "down")
    expect(first?.x).toBeCloseTo(1, 2)
    expect(first?.y).toBeCloseTo(1, 2)

    if (picker) {
      picker.value = "left"
      picker.dispatchEvent(new Event("change", { bubbles: true }))
    }
    fakes.sent = []
    stage?.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 100 + 800 * 0.25,
        clientY: 50 + 600 * 0.75,
      }),
    )
    const second = fakes.sent.flat().find((event) => event.k === "down")
    expect(second?.x).toBeCloseTo(0.25, 2)
    expect(second?.y).toBeCloseTo(0.75, 2)
  })

  it("shows no picker on a computer with one display", async () => {
    fakes.computer = mac()
    await using screen = await mount(true)
    expect(screen.container.querySelector('[data-part="display-picker"]')).toBeNull()
  })
})
