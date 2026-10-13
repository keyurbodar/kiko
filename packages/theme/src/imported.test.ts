import { describe, expect, test } from "bun:test"
import { formatImported, parseImported, themeFor, type ImportedTheme } from "./imported"
import { PALETTES } from "./palette"

const night: ImportedTheme = { id: "acme.night:extension/themes/night.json", name: "Night", source: "acme.night", appearance: "dark", accent: "#112233", palette: PALETTES.dark }
const day: ImportedTheme = { ...night, id: "acme.day:day.json", name: "Day", appearance: "light", palette: PALETTES.light }

describe("imported themes", () => {
  test("a stored state reads back the same", () => {
    const state = { themes: [night, day], active: { dark: night.id, light: day.id } }
    expect(parseImported(formatImported(state))).toEqual(state)
  })

  test("nothing stored, or text that is not a record, is no themes", () => {
    expect(parseImported(null).themes).toEqual([])
    expect(parseImported("[1,2]").themes).toEqual([])
    expect(parseImported('{"v":2,"themes":[]}').themes).toEqual([])
  })

  test("a theme with a bad color is dropped and the rest stay", () => {
    const bad = { ...night, id: "bad", palette: { ...PALETTES.dark, text: "red" } }
    expect(parseImported(formatImported({ themes: [bad, day], active: {} })).themes.map((t) => t.id)).toEqual([day.id])
  })

  test("an active id only counts for the appearance it was imported for", () => {
    const parsed = parseImported(formatImported({ themes: [night], active: { light: night.id, dark: night.id } }))
    expect(parsed.active).toEqual({ dark: night.id })
    expect(themeFor(parsed, "light")).toBeUndefined()
    expect(themeFor(parsed, "dark")).toEqual(night)
  })
})
