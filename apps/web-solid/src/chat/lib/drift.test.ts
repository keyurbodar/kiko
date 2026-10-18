import { describe, expect, test } from "bun:test"
import { AT_BOTTOM_THRESHOLD_PX, isAtBottom } from "./drift"

describe("isAtBottom", () => {
  test("true inside the threshold, false past it", () => {
    expect(isAtBottom(1400, 1900, 500, AT_BOTTOM_THRESHOLD_PX)).toBe(true)
    expect(isAtBottom(1368, 1900, 500, AT_BOTTOM_THRESHOLD_PX)).toBe(true)
    expect(isAtBottom(1367, 1900, 500, AT_BOTTOM_THRESHOLD_PX)).toBe(false)
  })

  test("exactly at the threshold counts as bottom", () => {
    expect(isAtBottom(1900 - 500 - 32, 1900, 500, 32)).toBe(true)
    expect(isAtBottom(1900 - 500 - 32.5, 1900, 500, 32)).toBe(false)
  })

  test("the threshold is a reading band, not the physical floor", () => {
    // The same 1.5px gap: inside the 32px reading band, outside a 1px floor.
    expect(isAtBottom(1398.5, 1900, 500, AT_BOTTOM_THRESHOLD_PX)).toBe(true)
    expect(isAtBottom(1398.5, 1900, 500, 1)).toBe(false)
  })

  test("a thread shorter than the viewport is at the bottom from the start", () => {
    expect(isAtBottom(0, 300, 500, AT_BOTTOM_THRESHOLD_PX)).toBe(true)
  })

  test("an empty thread is at the bottom", () => {
    expect(isAtBottom(0, 0, 0, AT_BOTTOM_THRESHOLD_PX)).toBe(true)
  })
})
