import { describe, expect, test } from "bun:test"
import {
  AT_BOTTOM_THRESHOLD_PX,
  PINNED_CENTER_DRIFT_EPSILON_PX,
  SCROLL_OWNER,
  SCROLL_OWNERSHIP,
  TRUE_BOTTOM_THRESHOLD_PX,
  VIRTUALIZER_ROLE,
  computeAnchor,
  getPinnedCenterDrift,
  isAtBottom,
  settleProgrammaticBottomPin,
  shouldSettleForVirtualizedBottom,
  type BottomSettleContainer,
  type RowRect,
} from "./anchoring"

const row = (
  messageId: string | undefined,
  top: number,
  bottom: number,
): RowRect => ({ messageId, top, bottom })

const fakeContainer = (
  scrollHeight: number,
  clientHeight: number,
  initialScrollTop: number,
  scrolls = true,
) => {
  const calls: number[] = []
  const container = {
    scrollHeight,
    clientHeight,
    scrollTop: initialScrollTop,
    scrollTo: ((options?: ScrollToOptions) => {
      const top = options?.top ?? 0
      calls.push(top)
      if (scrolls) {
        container.scrollTop = Math.max(
          0,
          Math.min(top, scrollHeight - clientHeight),
        )
      }
    }) as BottomSettleContainer["scrollTo"],
    calls,
  }
  return container
}

describe("scroll ownership", () => {
  test("createAutoScroll owns the scroll element; the virtualizer only windows rows", () => {
    expect(SCROLL_OWNERSHIP).toEqual({
      scrollOwner: SCROLL_OWNER,
      virtualizerRole: VIRTUALIZER_ROLE,
    })
    expect(SCROLL_OWNER).toBe("create-auto-scroll")
    expect(VIRTUALIZER_ROLE).toBe("virtualization-only")
  })
})

describe("isAtBottom", () => {
  test("a reader parked on the physical floor is at bottom", () => {
    expect(isAtBottom(1400, 1900, 500, AT_BOTTOM_THRESHOLD_PX)).toBe(true)
  })

  test("a reader parked inside the threshold band is still at bottom", () => {
    expect(isAtBottom(1368, 1900, 500, AT_BOTTOM_THRESHOLD_PX)).toBe(true)
  })

  test("exactly at the threshold counts as bottom, one pixel past does not", () => {
    expect(isAtBottom(1368, 1900, 500, 32)).toBe(true)
    expect(isAtBottom(1367, 1900, 500, 32)).toBe(false)
  })

  test("the physical floor threshold rejects a 1.5px gap the UI band accepts", () => {
    expect(isAtBottom(1398.5, 1900, 500, AT_BOTTOM_THRESHOLD_PX)).toBe(true)
    expect(isAtBottom(1398.5, 1900, 500, TRUE_BOTTOM_THRESHOLD_PX)).toBe(false)
  })
})

describe("computeAnchor", () => {
  test("anchors on the first row whose bottom edge has crossed below the container top", () => {
    const rows = [
      row("m1", -420, -360),
      row("m2", -360, -280),
      row("m3", -280, 40),
      row("m4", 40, 200),
    ]
    expect(computeAnchor({ top: 0 }, rows)).toEqual({
      kind: "message",
      messageId: "m3",
      topOffset: -280,
    })
  })

  test("anchors a straddling row by its negative top offset, not the row above it", () => {
    const rows = [row("m1", -60, 20), row("m2", 20, 140)]
    expect(computeAnchor({ top: 0 }, rows)).toEqual({
      kind: "message",
      messageId: "m1",
      topOffset: -60,
    })
  })

  test("a row whose bottom exactly touches the container top has not crossed", () => {
    const rows = [row("m1", -200, 0), row("m2", 0, 120)]
    expect(computeAnchor({ top: 0 }, rows)).toEqual({
      kind: "message",
      messageId: "m2",
      topOffset: 0,
    })
  })

  test("is at bottom when every measured row sits above the container top", () => {
    const rows = [row("m1", -600, -520), row("m2", -520, -440)]
    expect(computeAnchor({ top: 0 }, rows)).toEqual({ kind: "at-bottom" })
  })

  test("is at bottom for an empty row set", () => {
    expect(computeAnchor({ top: 0 }, [])).toEqual({ kind: "at-bottom" })
  })

  test("skips rows carrying no message id instead of anchoring on them", () => {
    const rows = [row(undefined, -300, -200), row("m9", -200, 60)]
    expect(computeAnchor({ top: 0 }, rows)).toEqual({
      kind: "message",
      messageId: "m9",
      topOffset: -200,
    })
  })

  test("measures the offset against a container scrolled off the window origin", () => {
    const rows = [row("m1", 100, 240), row("m2", 240, 380)]
    expect(computeAnchor({ top: 90 }, rows)).toEqual({
      kind: "message",
      messageId: "m1",
      topOffset: 10,
    })
  })
})

describe("shouldSettleForVirtualizedBottom", () => {
  test("an arriving message while the reader is at the bottom settles", () => {
    expect(
      shouldSettleForVirtualizedBottom({
        isAtBottom: true,
        delta: "append",
        arrived: 1,
        changed: false,
      }),
    ).toBe(true)
  })

  test("an arriving message while the reader is scrolled up never settles", () => {
    expect(
      shouldSettleForVirtualizedBottom({
        isAtBottom: false,
        delta: "append",
        arrived: 1,
        changed: true,
      }),
    ).toBe(false)
  })

  test("a prepend never settles even at the bottom with content changed", () => {
    expect(
      shouldSettleForVirtualizedBottom({
        isAtBottom: true,
        delta: "prepend",
        arrived: 5,
        changed: true,
      }),
    ).toBe(false)
  })

  test("a quiet pass with nothing arrived and nothing changed does not settle", () => {
    expect(
      shouldSettleForVirtualizedBottom({
        isAtBottom: true,
        delta: "none",
        arrived: 0,
        changed: false,
      }),
    ).toBe(false)
  })

  test("a replace that changed existing content settles at the bottom", () => {
    expect(
      shouldSettleForVirtualizedBottom({
        isAtBottom: true,
        delta: "replace",
        arrived: 0,
        changed: true,
      }),
    ).toBe(true)
  })
})

describe("settleProgrammaticBottomPin", () => {
  test("writes the physical floor and reports success", () => {
    const container = fakeContainer(2000, 500, 1500)
    expect(settleProgrammaticBottomPin(container)).toBe(true)
    expect(container.calls).toEqual([2000])
    expect(container.scrollTop).toBe(1500)
  })

  test("reports failure when the element refuses the write", () => {
    const container = fakeContainer(2000, 500, 1200, false)
    expect(settleProgrammaticBottomPin(container)).toBe(false)
    expect(container.calls).toEqual([2000])
    expect(container.scrollTop).toBe(1200)
  })

  test("a write that overshoots the floor is measured after the clamp", () => {
    const container = fakeContainer(2000, 500, 100)
    expect(settleProgrammaticBottomPin(container)).toBe(true)
    expect(container.scrollTop).toBe(1500)
  })
})

describe("getPinnedCenterDrift", () => {
  test("drift inside the epsilon is not a real correction", () => {
    expect(
      getPinnedCenterDrift({ contentTop: 500, currentContentTop: 500.4 }),
    ).toBeNull()
    expect(
      getPinnedCenterDrift({ contentTop: 500, currentContentTop: 499.6 }),
    ).toBeNull()
  })

  test("drift past the epsilon is reported signed", () => {
    expect(
      getPinnedCenterDrift({ contentTop: 500, currentContentTop: 500.6 }),
    ).toBeCloseTo(0.6, 10)
    expect(
      getPinnedCenterDrift({ contentTop: 500, currentContentTop: 499.4 }),
    ).toBeCloseTo(-0.6, 10)
  })

  test("a pinned row that has not moved reports no drift", () => {
    expect(
      getPinnedCenterDrift({ contentTop: 500, currentContentTop: 500 }),
    ).toBeNull()
  })

  test("the epsilon is the physical floor's half-pixel scale", () => {
    expect(PINNED_CENTER_DRIFT_EPSILON_PX).toBe(0.5)
  })
})
