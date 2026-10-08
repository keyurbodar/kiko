import { describe, expect, test } from "bun:test"
import { SETTINGS_GROUPS, SETTINGS_SECTIONS, searchSections } from "./sections"

describe("settings sections", () => {
  test("every section sits in a listed group, and the groups keep the sections together", () => {
    const groups = SETTINGS_SECTIONS.map((s) => s.group)
    expect(groups.every((g) => (SETTINGS_GROUPS as readonly string[]).includes(g))).toBe(true)
    expect([...new Set(groups)]).toEqual([...SETTINGS_GROUPS])
  })

  test("search keeps a section only when every word is in its label, hint, or keywords", () => {
    expect(searchSections("").map((s) => s.id)).toEqual(SETTINGS_SECTIONS.map((s) => s.id))
    expect(searchSections("api key").map((s) => s.id)).toEqual(["models"])
    expect(searchSections("sign out").map((s) => s.id)).toEqual(["account"])
    expect(searchSections("wallpaper").map((s) => s.id)).toEqual(["appearance"])
    expect(searchSections("nothing like this")).toEqual([])
  })
})
