import "../../index.css"
import { createSignal } from "solid-js"
import { describe, expect, it, vi } from "vitest"
import { render } from "../../../test/render"
import { ThoughtStream } from "./Thinking"

const stream = (host: HTMLElement) => host.querySelector<HTMLElement>(".thinking-stream")!

describe("ThoughtStream", () => {
  it("grows across two snapshots without dropping text", async () => {
    const [text, setText] = createSignal("First thought.")
    await using screen = await render(() => <ThoughtStream text={text()} live />)
    const box = stream(screen.container)

    expect(box.textContent).toContain("First thought.")
    expect(box.hasAttribute("data-streaming")).toBe(true)

    setText("First thought. Second thought arrives.")
    expect(box.textContent).toContain("First thought.")

    await vi.waitFor(() => expect(box.textContent).toContain("Second thought arrives."))
    expect(box.textContent).toContain("First thought.")
  })

  it("renders a finished thought static with no streaming attribute", async () => {
    const [live, setLive] = createSignal(true)
    await using screen = await render(() => <ThoughtStream text="A finished thought." live={live()} />)
    const box = stream(screen.container)

    expect(box.hasAttribute("data-streaming")).toBe(true)

    setLive(false)

    await vi.waitFor(() => expect(box.hasAttribute("data-streaming")).toBe(false))
    expect(box.textContent).toContain("A finished thought.")
  })
})
