import { describe, expect, it } from "vitest"
import { ZERO_BACKGROUND, backgroundSafe, counterCell, unmeasured } from "./background"
import type { Background } from "./types"

const withUnmeasured = (...unmeasuredCounters: NonNullable<Background["unmeasured"]>): Background => ({
  ...ZERO_BACKGROUND,
  unmeasured: unmeasuredCounters,
})

describe("background", () => {
  it("treats a clean measurement as safe", () => {
    expect(backgroundSafe(ZERO_BACKGROUND)).toBe(true)
    expect(unmeasured(ZERO_BACKGROUND).size).toBe(0)
  })

  it("is unsafe on any nonzero counter", () => {
    expect(backgroundSafe({ ...ZERO_BACKGROUND, keysSwallowed: 1 })).toBe(false)
    expect(backgroundSafe({ ...ZERO_BACKGROUND, windowsRaised: 2 })).toBe(false)
  })

  it("is unsafe when a counter was not measured", () => {
    expect(backgroundSafe(withUnmeasured("pointerMoves"))).toBe(false)
  })

  it("writes unmeasured instead of zero", () => {
    const background = withUnmeasured("pointerMoves")
    expect(counterCell(background, "pointerMoves")).toBe("unmeasured")
    expect(counterCell(background, "focusSteals")).toBe(0)
    expect(counterCell({ ...background, focusSteals: 3 }, "focusSteals")).toBe(3)
  })
})
