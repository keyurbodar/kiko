import { describe, expect, it } from "vitest"
import { render } from "../../../test/render"
import { Snowflake } from "./Snowflake"

describe("Snowflake", () => {
  it("draws six arms and carries no parent face by default", async () => {
    await using screen = await render(() => <Snowflake seed="w1" state="working" />)
    expect(screen.container.querySelectorAll("svg path")).toHaveLength(6)
    expect(screen.container.querySelector('[data-component="helper-parent"]')).toBeNull()
    expect(screen.container.querySelector('[data-component="helper-flake"]')?.getAttribute("data-state")).toBe(
      "working",
    )
  })

  it("shows the parent agent's face in the corner when given one", async () => {
    await using screen = await render(() => <Snowflake seed="w1" parent="alpha" />)
    const face = screen.container.querySelector('[data-component="helper-parent"] [data-seed]')
    expect(face?.getAttribute("data-seed")).toBe("alpha")
  })
})
