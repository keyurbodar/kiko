import { describe, expect, test } from "bun:test"
import {
  AT_BOTTOM_THRESHOLD_PX,
  DRIFT_EPSILON,
  driftCompensation,
  isAtBottom,
} from "./drift"

/**
 * A transcript as the virtualizer sees it: each row has a top offset derived
 * from the rows above it. Measuring a row for real can only change the offsets
 * of the rows BELOW it, so the model here is a prefix sum over row heights.
 */
type Row = { readonly id: string; readonly top: number; readonly height: number }

const layout = (heights: readonly number[]): readonly Row[] => {
  const rows: Row[] = []
  let top = 0
  heights.forEach((height, index) => {
    rows.push({ id: `m${index}`, top, height })
    top += height
  })
  return rows
}

/**
 * What the reader is looking at, expressed the same way the DOM does: a row's
 * position relative to the column, and the column's position relative to the
 * viewport. Their difference is the row's on-screen top.
 */
const onScreenTop = (rows: readonly Row[], id: string, scrollOffset: number): number =>
  (rows.find((row) => row.id === id)?.top ?? 0) - scrollOffset

describe("driftCompensation", () => {
  test("a row measured 37px taller than its estimate does not move the viewport", () => {
    // The reading line sits over m4. Everything above it is already measured,
    // so the only way a late measurement can move m4 is by changing a row
    // above it.
    const estimated = layout([60, 60, 60, 60, 60, 60])
    const readingRow = "m4"
    const scrollOffset = 240
    const before = onScreenTop(estimated, readingRow, scrollOffset)

    // m2's estimate was 37px short. Real is 97. Every row below m2 slides down
    // by 37, so at an unchanged scroll offset the reading row appears 37px
    // lower than the reader last saw it.
    const measured = layout([60, 60, 97, 60, 60, 60])
    const afterUncorrected = onScreenTop(measured, readingRow, scrollOffset)
    expect(afterUncorrected - before).toBe(37)

    // The shell measures that discrepancy and asks what to scroll by. The
    // reader is mid-thread here — 240px into a 1000px range with a 500px
    // viewport leaves 260px unread below, well past the reading band.
    const drift = afterUncorrected - before
    const readerIsAtBottom = isAtBottom(scrollOffset, 1000, 500, AT_BOTTOM_THRESHOLD_PX)
    expect(readerIsAtBottom).toBe(false)
    const compensation = driftCompensation(drift, readerIsAtBottom)
    expect(compensation).toBe(37)

    // Applying it puts the reading row back exactly where the reader left it.
    expect(onScreenTop(measured, readingRow, scrollOffset + compensation)).toBe(before)
  })

  test("an estimate that was too tall drifts the other way and corrects the same way", () => {
    const estimated = layout([60, 60, 60, 60, 60])
    const measured = layout([60, 60, 24, 60, 60])
    const drift = onScreenTop(measured, "m4", 120) - onScreenTop(estimated, "m4", 120)
    expect(drift).toBe(-36)
    expect(driftCompensation(drift, false)).toBe(-36)
    expect(onScreenTop(measured, "m4", 120 - 36)).toBe(onScreenTop(estimated, "m4", 120))
  })

  test("a reader parked at the bottom is not corrected, because the end moved", () => {
    expect(driftCompensation(37, true)).toBe(0)
    expect(driftCompensation(-37, true)).toBe(0)
  })

  test("a drift under half a pixel is subpixel layout, not a jump", () => {
    expect(driftCompensation(DRIFT_EPSILON, false)).toBe(0)
    expect(driftCompensation(DRIFT_EPSILON / 2, false)).toBe(0)
    expect(driftCompensation(-DRIFT_EPSILON / 2, false)).toBe(0)
    expect(driftCompensation(DRIFT_EPSILON + 0.25, false)).toBe(DRIFT_EPSILON + 0.25)
  })

  test("a row that detached mid-measurement leaves the reader where they are", () => {
    expect(driftCompensation(Number.NaN, false)).toBe(0)
    expect(driftCompensation(Number.POSITIVE_INFINITY, false)).toBe(0)
  })
})

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
