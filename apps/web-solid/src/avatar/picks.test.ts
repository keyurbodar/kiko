import { describe, expect, test } from "bun:test"
import { pinsFor, setAvatarPicks } from "./picks"

describe("avatar pins", () => {
  test("Kiko keeps its flavor and changes only what it wears", () => {
    setAvatarPicks({ kiko: { flavour: "matcha", charm: "beret" } })
    expect(pinsFor("kiko")).toEqual({ flavour: "fubuki", charm: "beret" })
    setAvatarPicks({})
  })

  test("another agent keeps the pins it was given", () => {
    setAvatarPicks({ ada: { flavour: "matcha", outfit: "none" } })
    expect(pinsFor("ada")).toEqual({ flavour: "matcha", outfit: "none" })
    expect(pinsFor("bo")).toEqual({})
    setAvatarPicks({})
  })

  test("a draft replaces the saved pins for the preview", () => {
    setAvatarPicks({ ada: { flavour: "matcha" } })
    expect(pinsFor("ada", { charm: "ribbon" })).toEqual({ charm: "ribbon" })
    setAvatarPicks({})
  })
})
