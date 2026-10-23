import { describe, expect, it } from "vitest"
import { render } from "../../../test/render"
import { AgentChip } from "./agent-chip"

describe("AgentChip", () => {
  it("shows the agent's name, prefixed with @ only as a mention", async () => {
    await using screen = await render(() => (
      <p>
        <AgentChip slug="scout" name="Scout" />
        <AgentChip slug="scout" name="Scout" handle />
      </p>
    ))

    const [chip, mention] = screen.getByTitle("Scout").elements()
    expect(chip?.textContent?.trim()).toBe("Scout")
    expect(chip).toHaveAttribute("data-component", "agent-chip")
    expect(mention?.textContent?.trim()).toBe("@Scout")
    expect(mention).toHaveAttribute("data-component", "chat-mention")
  })

  it("paints one agent the same color everywhere and another agent differently", async () => {
    await using screen = await render(() => (
      <p>
        <AgentChip slug="scout" name="Scout" />
        <AgentChip slug="scout" name="Scout" handle />
        <AgentChip slug="harper" name="Harper" />
      </p>
    ))

    const color = (element: Element | undefined) => (element ? getComputedStyle(element).color : "")
    const [first, again] = screen.getByTitle("Scout").elements()
    const scout = color(first)
    expect(scout).not.toBe("")
    expect(color(again)).toBe(scout)
    expect(color(screen.getByTitle("Harper").element())).not.toBe(scout)
  })

  it("removes the chip from the page when the test lets go of it", async () => {
    const container = document.createElement("div")
    {
      await using screen = await render(() => <AgentChip slug="scout" name="Scout" />, { container })
      await expect.element(screen.getByTitle("Scout")).toBeVisible()
    }
    expect(container.isConnected).toBe(false)
    expect(container.textContent).toBe("")
  })
})
