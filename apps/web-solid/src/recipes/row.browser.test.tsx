import "../index.css"
import "./recipe.css"
import type { RecipeCard, RecipeInstall } from "@kiko/protocol"
import { describe, expect, it, vi } from "vitest"
import { userEvent } from "vitest/browser"
import { render } from "../../test/render"
import { RECIPES } from "./catalog.gen"
import { localizeWhen } from "./model"
import { InstallCard } from "./row"

vi.mock("../state/room", () => ({
  room: { chatById: () => ({ name: "Kiko" }), chatFaces: () => [] },
}))

const card = RECIPES.find((entry) => entry.slug === "apartment-hunter") as RecipeCard

const install = {
  installId: "install-1",
  slug: card.slug,
  roomId: "room-1",
  agent: "kiko",
  at: 0,
  routines: [],
} as unknown as RecipeInstall

describe("installed recipe", () => {
  it("names its schedule once when it has not been set up yet", async () => {
    await using screen = await render(() => <InstallCard install={install} card={card} />)
    const schedule = localizeWhen(card.when)
    expect(schedule).not.toBe("")
    expect(screen.container.textContent!.split(schedule)).toHaveLength(2)
    expect(screen.container.querySelector('[data-component="recipe-status"]')).toBeNull()
  })

  it("keeps the recipe's icon in its tile while hovered", async () => {
    await using screen = await render(() => <InstallCard install={install} card={card} />)
    const glyph = screen.container.querySelector<SVGSVGElement>(".tpl-glyph")!
    await userEvent.hover(screen.container.querySelector(".tpl")!)
    for (const animation of glyph.getAnimations()) animation.finish()
    expect(glyph.querySelectorAll("path").length).toBeGreaterThan(0)
    expect(getComputedStyle(glyph).opacity).toBe("1")
    expect(glyph.getBoundingClientRect().width).toBeGreaterThan(0)
  })
})
