import "../../index.css"
import { describe, expect, it, vi } from "vitest"
import { createSignal } from "solid-js"
import { render } from "../../../test/render"
import { FilePeek } from "./FilePeek"

const readText = vi.hoisted(() => vi.fn())

vi.mock("../../files/api", () => ({
  isTextFile: () => true,
  readText,
}))

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n")

const file = { id: "f1", name: "notes.md", size: 2048, type: "text/markdown" } as never

function Harness(props: { note?: string }) {
  const [anchor, setAnchor] = createSignal<HTMLButtonElement>()
  return (
    <div>
      <button type="button" ref={(el) => setAnchor(el)}>
        notes.md
      </button>
      <FilePeek file={file} name="notes.md" note={props.note ?? "In this chat"} anchor={anchor} />
    </div>
  )
}

const peek = (_host: HTMLElement) => document.querySelector<HTMLElement>('[data-component="chat-file-peek"]')
const chip = (host: HTMLElement) => host.querySelector("button")!

describe("FilePeek", () => {
  it("stays hidden until the pointer rests on the chip for its delay", async () => {
    readText.mockResolvedValue({ kind: "text", text: lines(6) })
    await using screen = await render(() => <Harness />)

    expect(peek(screen.container)).toBeNull()

    chip(screen.container).dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }))

    await vi.waitFor(() => expect(peek(screen.container)).not.toBeNull())
  })

  it("shows the name, its size and the first lines of the file", async () => {
    readText.mockResolvedValue({ kind: "text", text: lines(9) })
    await using screen = await render(() => <Harness />)

    chip(screen.container).dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }))

    const card = await vi.waitFor(() => {
      const found = peek(screen.container)
      expect(found).not.toBeNull()
      return found!
    })
    expect(card.textContent).toContain("notes.md")
    expect(card.textContent).toContain("2.0 KB")
    expect(card.textContent).toContain("In this chat")
    expect([...card.querySelectorAll(".file-peek-lines span")].map((line) => line.textContent)).toEqual([
      "line 1",
      "line 2",
      "line 3",
      "line 4",
    ])
  })

  it("goes away when the pointer leaves, so it never traps the pointer", async () => {
    readText.mockResolvedValue({ kind: "text", text: lines(3) })
    await using screen = await render(() => <Harness />)

    chip(screen.container).dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }))
    await vi.waitFor(() => expect(peek(screen.container)).not.toBeNull())

    chip(screen.container).dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }))

    await vi.waitFor(() => expect(peek(screen.container)).toBeNull())
  })
})
