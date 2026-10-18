import { describe, expect, test } from "bun:test"
import { collapseLimit, FOLD_SLACK, shouldFold } from "./fold"

describe("the fold limit", () => {
  test("a desktop window shows a medium answer whole", () => {
    // A 12-line answer is about 310 px. The old 180 px limit folded it; this one must not.
    expect(shouldFold(310, collapseLimit(900, false))).toBe(false)
    expect(shouldFold(310, collapseLimit(1080, false))).toBe(false)
  })

  test("a long answer still folds, so the next message stays on screen", () => {
    expect(shouldFold(1400, collapseLimit(900, false))).toBe(true)
    expect(shouldFold(1400, collapseLimit(600, true))).toBe(true)
  })

  test("a phone gets a taller share, because the same words take more lines", () => {
    expect(collapseLimit(800, true)).toBeGreaterThan(collapseLimit(800, false))
  })

  test("the limit stays inside a readable band on any window", () => {
    for (const height of [320, 600, 900, 1440, 2160]) {
      const wide = collapseLimit(height, false)
      expect(wide).toBeGreaterThanOrEqual(480)
      expect(wide).toBeLessThanOrEqual(900)
    }
  })

  test("a body just over the limit is not worth a button", () => {
    const limit = collapseLimit(900, false)
    expect(shouldFold(limit, limit)).toBe(false)
    expect(shouldFold(limit * (1 + FOLD_SLACK), limit)).toBe(false)
    expect(shouldFold(limit * (1 + FOLD_SLACK) + 1, limit)).toBe(true)
  })

  test("a photo is never folded", () => {
    expect(shouldFold(5000, collapseLimit(900, false), true)).toBe(false)
  })
})
