import { describe, expect, it } from "vitest"
import { flake } from "./snowflake"

describe("snowflake", () => {
  it("draws the same flake for the same helper every time", () => {
    expect(flake("w1")).toEqual(flake("w1"))
  })

  it("gives different helpers different flakes", () => {
    const arms = new Set(Array.from({ length: 24 }, (_, i) => flake(`helper-${i}`).arm))
    expect(arms.size).toBeGreaterThan(20)
  })

  it("keeps every arm inside the 24 unit canvas", () => {
    for (let i = 0; i < 50; i++) {
      const numbers = [...flake(`h${i}`).arm.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Math.abs(Number(m[0])))
      expect(Math.max(...numbers)).toBeLessThanOrEqual(11.5)
    }
  })
})
