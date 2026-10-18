import { describe, expect, test } from "bun:test"
import { landingSection, SETTINGS_GROUPS, SETTINGS_SECTIONS, searchSections } from "./sections"

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
    expect(searchSections("open vsx").map((s) => s.id)).toEqual(["appearance"])
    expect(searchSections("nothing like this")).toEqual([])
  })

  test("search ignores case, so a sentence-case label still matches", () => {
    expect(searchSections("models").map((s) => s.id)).toEqual(["models"])
    expect(searchSections("Composio").map((s) => s.id)).toEqual(["tools"])
    expect(searchSections("APPEARANCE").map((s) => s.id)).toEqual(["appearance"])
  })

  test("an old settings link lands on its section, a merged one where it went, anything else on models", () => {
    for (const s of SETTINGS_SECTIONS) expect(landingSection(s.id)).toBe(s.id)
    expect(landingSection("integrations")).toBe("tools")
    expect(landingSection("initiative")).toBe("general")
    expect(landingSection()).toBe("models")
    expect(landingSection("nothing-here")).toBe("models")
    // A name every object inherits is not a section either.
    expect(landingSection("constructor")).toBe("models")
  })
})
