import { expect, test } from "bun:test"
import { faceOptions, handleFrom, problems, ready, shufflePins, suggestHandle, tidyName, uniqueHandle } from "./model"

const taken = [
  { name: "Scout", slug: "scout" },
  { name: "Scout two", slug: "scout-2" },
]

test("a handle comes from the name: lowercase words joined by dashes", () => {
  expect(handleFrom("Trip Planner")).toBe("trip-planner")
  expect(handleFrom("  Zoë's  Helper!! ")).toBe("zoe-s-helper")
  expect(handleFrom("***")).toBe("")
  expect(handleFrom("a".repeat(40))).toHaveLength(32)
})

test("a handle that is taken gets the next free number, and kiko is always taken", () => {
  expect(suggestHandle("Scout", taken)).toBe("scout-3")
  expect(suggestHandle("Fresh", taken)).toBe("fresh")
  expect(suggestHandle("Kiko", [])).toBe("kiko-2")
  expect(uniqueHandle("a".repeat(32), [{ name: "x", slug: "a".repeat(32) }])).toBe(`${"a".repeat(30)}-2`)
  expect(suggestHandle("", [])).toBe("")
})

test("problems name the field before submit, ignoring case and spaces", () => {
  expect(problems({ name: " scout ", handle: "fresh", description: "x" }, taken)).toEqual({ name: "An agent already has this name" })
  expect(problems({ name: "KIKO", handle: "fresh", description: "x" }, taken)).toEqual({ name: "An agent already has this name" })
  expect(problems({ name: "Bee", handle: "@scout", description: "x" }, taken)).toEqual({ handle: "This handle is taken" })
  expect(problems({ name: "Bee", handle: "Bad Handle", description: "x" }, taken)).toEqual({ handle: "Use lowercase letters, digits, and dashes" })
  expect(problems({ name: "Bee", handle: "bee", description: "x" }, taken)).toEqual({})
})

test("create is ready only with a name, a handle, a description, and no problem", () => {
  expect(ready({ name: "Bee", handle: "bee", description: "keeps bees" }, taken)).toBe(true)
  expect(ready({ name: "Bee", handle: "bee", description: "  " }, taken)).toBe(false)
  expect(ready({ name: "", handle: "bee", description: "x" }, taken)).toBe(false)
  expect(ready({ name: "Scout", handle: "bee", description: "x" }, taken)).toBe(false)
})

test("shuffle pins a flavor and never a charm with an outfit", () => {
  for (let i = 0; i < 200; i++) {
    const pins = shufflePins()
    expect(pins.flavour).toBeDefined()
    expect(pins.charm !== "none" && pins.outfit !== "none").toBe(false)
  }
  expect(shufflePins(() => 0)).toMatchObject({ flavour: "fubuki" })
})

test("the name is stored trimmed with a capital", () => {
  expect(tidyName("  ebert ")).toBe("Ebert")
})

test("the first face is drawn from the handle alone, the rest are picks", () => {
  const faces = faceOptions(() => 0.1)
  expect(faces).toHaveLength(8)
  expect(faces[0]).toEqual({})
  expect(faces.slice(1).every((f) => f.flavour !== undefined)).toBe(true)
})
