import { describe, expect, test } from "bun:test"
import { groupForDisplay, parsePrefs } from "./model-prefs"

describe("model prefs", () => {
  test("favorites come first in starred order, then shown, then hidden", () => {
    const refs = ["a/1", "a/2", "a/3", "a/4", "a/5"]
    const out = groupForDisplay(refs, (r) => r, { favorites: ["a/4", "a/2"], hidden: ["a/3", "a/2"] })
    expect(out.favorites).toEqual(["a/4", "a/2"])
    expect(out.shown).toEqual(["a/1", "a/5"])
    // A hidden favorite stays with the favorites; the rest of the hidden sink to the end.
    expect(out.hidden).toEqual(["a/3"])
  })

  test("unreadable or malformed storage is no prefs", () => {
    expect(parsePrefs(null)).toEqual({ favorites: [], hidden: [] })
    expect(parsePrefs("{ nope")).toEqual({ favorites: [], hidden: [] })
    expect(parsePrefs(JSON.stringify({ favorites: ["a/1", 3, "a/1"], hidden: "x" }))).toEqual({ favorites: ["a/1"], hidden: [] })
  })
})
