import "../../index.css"
import { describe, expect, it } from "vitest"
import { page } from "vitest/browser"
import { render } from "../../../test/render"
import { RunErrorCard } from "./RunErrorCard"

const NOTE = "The provider asked to wait longer than 60 s before the next request."

describe("RunErrorCard", () => {
  it("shows the provider's words in a floating card without moving the chat", async () => {
    await using screen = await render(() => (
      <>
        <RunErrorCard label="Kiko could not answer" reason="Anthropic: rate limited" note={NOTE} latest />
        <p data-testid="below">next message</p>
      </>
    ))
    const head = screen.getByRole("button", { name: /Kiko could not answer/ })
    const below = screen.getByTestId("below").element()
    const before = below.getBoundingClientRect().top
    expect(screen.container.textContent).not.toContain(NOTE)

    await head.click()

    await expect.element(page.getByText(NOTE)).toBeVisible()
    await expect.element(head).toHaveAttribute("aria-expanded", "true")
    expect(below.getBoundingClientRect().top).toBe(before)
    expect(screen.container.textContent).not.toContain(NOTE)
  })

  it("has nothing to open when the provider gave no message", async () => {
    await using screen = await render(() => <RunErrorCard label="Kiko could not answer" reason="Stopped" latest />)
    await expect.element(screen.getByRole("button", { name: /Kiko could not answer/ })).toBeDisabled()
  })
})
