import type { RecipeInstall, RoomId } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { freeSlug, localizeWhen, openingSection, recipeTemplate } from "./model"

const install: RecipeInstall = {
  installId: "install-1",
  slug: "daily-weather",
  roomId: "01890000-0000-7000-8000-000000000001" as RoomId,
  agent: "kiko",
  at: 1,
  routines: [],
}

describe("openingSection", () => {
  it("picks no tab while the owner's installs are still unknown", () => {
    expect(openingSection(undefined, false)).toBeUndefined()
  })

  it("opens on the owner's recipes once they are known to have some", () => {
    expect(openingSection([install], false)).toBe("yours")
  })

  it("opens on discover when the owner has none or is adding to a chat", () => {
    expect(openingSection([], false)).toBe("discover")
    expect(openingSection([install], true)).toBe("discover")
  })
})

describe("localizeWhen", () => {
  const plain = (text: string) => text.replace(/\s/g, " ")

  it("shows clock times the way the owner's locale writes them", () => {
    expect(plain(localizeWhen("Daily at 21:00", "en-US"))).toBe("Daily at 9:00 PM")
    expect(plain(localizeWhen("Mondays at 8:30", "en-US"))).toBe("Mondays at 8:30 AM")
    expect(localizeWhen("Daily at 21:00", "de-DE")).toBe("Daily at 21:00")
  })

  it("converts hour ranges and leaves other wording alone", () => {
    expect(plain(localizeWhen("Every 2 hours, 8 to 22", "en-US"))).toBe("Every 2 hours, 8 AM to 10 PM")
    expect(localizeWhen("Checks every 30 minutes", "en-US")).toBe("Checks every 30 minutes")
  })
})

describe("freeSlug", () => {
  it("takes the plain name first and then counts up past taken ones", () => {
    expect(freeSlug(new Set())).toBe("my-recipe")
    expect(freeSlug(new Set(["my-recipe", "my-recipe-2"]))).toBe("my-recipe-3")
  })
})

describe("recipeTemplate", () => {
  it("names the recipe after its folder so the server accepts it", () => {
    expect(recipeTemplate("my-recipe-2")).toContain("name: my-recipe-2\n")
  })
})
