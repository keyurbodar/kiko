import { describe, expect, test } from "bun:test"
import { parseHidden } from "./model-prefs"

describe("hidden models", () => {
  test("unreadable or malformed storage hides nothing, and duplicates collapse", () => {
    expect(parseHidden(null)).toEqual([])
    expect(parseHidden("{ nope")).toEqual([])
    expect(parseHidden(JSON.stringify({ hidden: "x" }))).toEqual([])
    expect(parseHidden(JSON.stringify({ hidden: ["a/1", 3, "a/1", "b/2"] }))).toEqual(["a/1", "b/2"])
  })
})
