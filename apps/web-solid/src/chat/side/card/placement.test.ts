import { describe, expect, test } from "bun:test"
import { cardPlacement } from "./placement"

describe("cardPlacement", () => {
  test.each([
    [0, "popover"],
    [390, "popover"],
    [887, "popover"],
    [888, "inline"],
    [1160, "inline"],
  ] as const)("a %i px chat panel is %s", (width, placement) => {
    expect(cardPlacement(width)).toBe(placement)
  })
})
