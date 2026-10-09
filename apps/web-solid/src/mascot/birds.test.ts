import { describe, expect, test } from "bun:test"
import { birdSvg, FLAVOR_IDS, formatBird, OUTFIT_IDS, parseBird, type BirdShape, type BirdState } from "./birds"

const YUKI = { flavor: "yuki", outfit: "none" } as const

describe("bird ids", () => {
  test("every flavor and outfit round-trips", () => {
    for (const flavor of FLAVOR_IDS) for (const outfit of OUTFIT_IDS) expect(parseBird(formatBird({ flavor, outfit }))).toEqual({ flavor, outfit })
  })

  test.each(["jay.0.cap", "matcha.sweater", "matcha", "plum.none", ""])("%p is no pick", (id) => {
    expect(parseBird(id)).toBeNull()
  })
})

describe("drawing", () => {
  test("two birds on one page never share a filter or clip id", () => {
    const ids = (svg: string) => [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1])
    const a = ids(birdSvg({ flavor: "matcha", outfit: "beanie" }))
    const b = ids(birdSvg({ flavor: "matcha", outfit: "beanie" }))
    expect(a.length).toBeGreaterThan(0)
    expect(a.filter((id) => b.includes(id))).toEqual([])
  })

  test("every reference points at a definition in the same drawing", () => {
    for (const shape of ["mochi", "loaf"] as BirdShape[])
      for (const flavor of FLAVOR_IDS)
        for (const outfit of OUTFIT_IDS)
          for (const size of [16, 48]) {
            const svg = birdSvg({ flavor, outfit }, "working", { shape, size })
            const defined = new Set([...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]))
            for (const [, ref] of svg.matchAll(/url\(#([^)]+)\)/g)) expect(defined.has(ref)).toBe(true)
          }
  })

  test.each<[BirdState, boolean]>([
    ["idle", false],
    ["thinking", true],
    ["working", true],
    ["typing", true],
    ["sending", false],
    ["sleeping", false],
  ])("a %p bird's ink boils: %p", (state, boils) => {
    expect(birdSvg(YUKI, state, { size: 48 }).includes('attributeName="seed"')).toBe(boils)
  })

  test("a working bird is still under reduced motion, and too small a bird draws a straight line", () => {
    expect(birdSvg(YUKI, "working", { size: 48, still: true })).not.toContain("<animate")
    expect(birdSvg(YUKI, "working", { size: 16 })).not.toContain("<filter")
    expect(birdSvg(YUKI, "idle", { flat: true, size: 64 })).not.toContain("<filter")
  })

  test("the ink line never drops under 1 px on screen", () => {
    const width = (size: number) => Number(/stroke-width="([\d.]+)"/.exec(birdSvg(YUKI, "idle", { size }))![1])
    for (const size of [16, 20, 24, 32, 48, 96]) expect((width(size) * size) / 103).toBeGreaterThanOrEqual(0.99)
  })

  test("a happy or sleeping bird closes its eyes, so nothing blinks them", () => {
    for (const state of ["wave", "sending", "sleeping"] as const) expect(birdSvg(YUKI, state)).not.toContain("bird-eyes")
    expect(birdSvg(YUKI, "idle")).toContain("bird-eyes")
  })

  test("nothing in a bird hops, flaps, or carries a prop", () => {
    for (const state of ["idle", "thinking", "working", "typing", "sending", "wave", "sleeping"] as const) {
      expect(birdSvg(YUKI, state, { size: 48 })).not.toMatch(/<text|bird-plane|bird-think|bird-spark|bird-zz/)
    }
  })
})
