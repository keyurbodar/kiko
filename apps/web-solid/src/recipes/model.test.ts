import type { RecipeInstall, RoomId } from "@kiko/protocol"
import { describe, expect, it } from "vitest"
import { openingSection } from "./model"

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
