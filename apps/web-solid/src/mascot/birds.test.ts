import { describe, expect, test } from "bun:test"
import { birdSvg, FLAVOR_IDS, formatBird, OUTFIT_IDS, parseBird, type BirdState } from "./birds"
import { daypartOf, GREETING, SEASON_OUTFIT, seasonOf } from "./scene"

describe("bird ids", () => {
  test("every flavor and outfit round-trips", () => {
    for (const flavor of FLAVOR_IDS) for (const outfit of OUTFIT_IDS) expect(parseBird(formatBird({ flavor, outfit }))).toEqual({ flavor, outfit })
  })

  test.each(["jay.0.cap", "kiko.1.none", "matcha", "matcha.hat", "plum.none", ""])("%p from before or broken is no pick", (id) => {
    expect(parseBird(id)).toBeNull()
  })
})

describe("drawing", () => {
  test("two birds on one page never share a gradient or clip id", () => {
    const ids = (svg: string) => [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1])
    const a = ids(birdSvg({ flavor: "matcha", outfit: "sweater" }))
    const b = ids(birdSvg({ flavor: "matcha", outfit: "sweater" }))
    expect(a.length).toBeGreaterThan(0)
    expect(a.filter((id) => b.includes(id))).toEqual([])
  })

  test("every reference points at a definition in the same drawing", () => {
    for (const flavor of FLAVOR_IDS) {
      for (const outfit of OUTFIT_IDS) {
        for (const flat of [false, true]) {
          const svg = birdSvg({ flavor, outfit }, "idle", { flat, ground: true })
          const defined = new Set([...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]))
          for (const [, ref] of svg.matchAll(/url\(#([^)]+)\)/g)) expect(defined.has(ref)).toBe(true)
        }
      }
    }
  })

  test.each<[BirdState, string]>([
    ["thinking", "bird-think"],
    ["working", "bird-spark"],
    ["sending", "bird-plane"],
    ["sleeping", "bird-zz"],
  ])("a bird %p shows %p", (state, prop) => {
    expect(birdSvg({ flavor: "yuki", outfit: "none" }, state)).toContain(prop)
    expect(birdSvg({ flavor: "yuki", outfit: "none" }, "idle")).not.toContain(prop)
  })

  test("a happy or sleeping bird closes its eyes, so nothing blinks them", () => {
    for (const state of ["wave", "sending", "sleeping"] as const) expect(birdSvg({ flavor: "yuki", outfit: "none" }, state)).not.toContain("bird-eyes")
    expect(birdSvg({ flavor: "yuki", outfit: "none" }, "idle")).toContain("bird-eyes")
  })
})

describe("scene", () => {
  test.each([
    [0, "winter", "snowcap"],
    [2, "spring", "blossom"],
    [6, "summer", "none"],
    [9, "autumn", "momiji"],
    [11, "winter", "snowcap"],
  ] as const)("month %p is %p and Yuki wears %p", (month, season, outfit) => {
    const s = seasonOf(new Date(2026, month, 15))
    expect(s).toBe(season)
    expect(SEASON_OUTFIT[s]).toBe(outfit)
  })

  test.each([
    [4, "night"],
    [5, "morning"],
    [12, "day"],
    [17, "evening"],
    [22, "night"],
  ] as const)("%p o'clock is %p", (hour, part) => {
    expect(daypartOf(new Date(2026, 9, 9, hour))).toBe(part)
    expect(GREETING[part]).toEndWith("What's on your mind?")
  })
})
