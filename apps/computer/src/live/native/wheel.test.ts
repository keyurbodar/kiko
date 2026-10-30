import { describe, expect, it } from "@effect/vitest"
import { notches } from "./wheel"

describe("wheel notches", () => {
  it("turns whole notches of pixels into clicks", () => {
    const vertical = notches(50)
    expect(vertical(120)).toBe(2)
    expect(vertical(-240)).toBe(-4)
  })

  it("adds up small trackpad deltas until they make a notch", () => {
    const vertical = notches(50)
    expect([20, 20, 20, 20, 20].map(vertical)).toEqual([0, 0, 1, 0, 1])
  })
})
