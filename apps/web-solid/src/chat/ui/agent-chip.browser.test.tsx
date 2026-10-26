import { describe, expect, it } from "vitest"
import { render } from "../../../test/render"
import { AgentChip } from "./agent-chip"

describe("AgentChip", () => {
  it("shows the agent's mascot and name as a mention", async () => {
    await using screen = await render(() => (
      <p>
        <AgentChip slug="scout" name="Scout" />
      </p>
    ))

    const chip = screen.getByTitle("Scout").element()
    expect(chip.textContent?.trim()).toBe("Scout")
    expect(chip).toHaveAttribute("data-component", "chat-mention")
    expect(chip.querySelector('[data-component="identity-avatar"]')).toHaveAttribute("data-seed", "scout")
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
