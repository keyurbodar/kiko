import { describe, expect, it } from "vitest"
import { samePositions } from "./flip"

describe("samePositions", () => {
  it("ignores the order the rows were measured in", () => {
    const before = new Map([
      ["a", 0],
      ["b", 40],
    ])
    const after = new Map([
      ["b", 40],
      ["a", 0],
    ])
    expect(samePositions(before, after)).toBe(true)
  })

  it("reports a row whose offset moved", () => {
    expect(samePositions(new Map([["a", 0]]), new Map([["a", 1]]))).toBe(false)
  })

  it("reports an added row", () => {
    expect(
      samePositions(
        new Map([["a", 0]]),
        new Map([
          ["a", 0],
          ["b", 40],
        ]),
      ),
    ).toBe(false)
  })

  it("reports a swapped row even when the count holds", () => {
    expect(samePositions(new Map([["a", 0]]), new Map([["b", 0]]))).toBe(false)
  })
})
