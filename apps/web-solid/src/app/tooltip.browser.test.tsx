import "../index.css"
import { TooltipV2 } from "@kiko/ui/v2/tooltip-v2"
import { describe, expect, it, vi } from "vitest"
import { userEvent } from "vitest/browser"
import { render } from "../../test/render"

const tip = () => document.querySelector<HTMLElement>('[data-component="tooltip-v2"]')

function Scene() {
  return (
    <div data-testid="scroller" style={{ height: "120px", overflow: "auto" }}>
      <div style={{ height: "600px", "padding-top": "20px" }}>
        <TooltipV2 value="Pop out chat" openDelay={0}>
          <button type="button">Pop out</button>
        </TooltipV2>
      </div>
    </div>
  )
}

function Pair() {
  return (
    <div style={{ display: "flex", gap: "8px", padding: "40px" }}>
      <TooltipV2 value="Settings">
        <button type="button">Gear</button>
      </TooltipV2>
      <TooltipV2 value="Help">
        <button type="button">Question</button>
      </TooltipV2>
    </div>
  )
}

describe("TooltipV2", () => {
  it("opens the next tooltip in the group at once while one is showing", async () => {
    await using screen = await render(() => <Pair />)
    await userEvent.hover(screen.getByRole("button", { name: "Gear" }))
    await vi.waitFor(() => expect(tip()?.textContent).toBe("Settings"))
    expect(tip()?.hasAttribute("data-instant")).toBe(false)

    await userEvent.hover(screen.getByRole("button", { name: "Question" }))

    await vi.waitFor(() => {
      const help = [...document.querySelectorAll<HTMLElement>('[data-component="tooltip-v2"]')].find(
        (el) => el.textContent === "Help",
      )
      expect(help?.hasAttribute("data-instant")).toBe(true)
    })
  })

  it("closes when the page scrolls under a still pointer", async () => {
    await using screen = await render(() => <Scene />)
    await userEvent.hover(screen.getByRole("button", { name: "Pop out" }))
    await vi.waitFor(() => expect(tip()).not.toBeNull())

    screen.getByTestId("scroller").element().dispatchEvent(new Event("scroll"))

    await vi.waitFor(() => expect(tip()).toBeNull())
  })

  it("closes when the window loses focus", async () => {
    await using screen = await render(() => <Scene />)
    await userEvent.hover(screen.getByRole("button", { name: "Pop out" }))
    await vi.waitFor(() => expect(tip()).not.toBeNull())

    window.dispatchEvent(new Event("blur"))

    await vi.waitFor(() => expect(tip()).toBeNull())
  })

  it("closes when the pointer leaves the window without leaving the button first", async () => {
    await using screen = await render(() => <Scene />)
    await userEvent.hover(screen.getByRole("button", { name: "Pop out" }))
    await vi.waitFor(() => expect(tip()).not.toBeNull())

    document.documentElement.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: null }))

    await vi.waitFor(() => expect(tip()).toBeNull())
  })
})
