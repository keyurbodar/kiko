import { describe, expect, test } from "bun:test"
import { SWIPE_PX, swipeAction } from "./edge-swipe"

const shut = { drawer: false, info: false }
const far = SWIPE_PX + 10

describe("phone swipes", () => {
  test("from the left edge, rightward, the drawer opens", () => {
    expect(swipeAction(shut, "edge", far, 0)).toBe("open-drawer")
    // Anywhere else a rightward swipe is a reply to a message, not the drawer.
    expect(swipeAction(shut, "other", far, 0)).toBeNull()
    expect(swipeAction(shut, "edge", -far, 0)).toBeNull()
  })

  test("leftward on the open drawer or its scrim closes it", () => {
    const open = { drawer: true, info: false }
    expect(swipeAction(open, "drawer", -far, 0)).toBe("close-drawer")
    expect(swipeAction(open, "scrim", -far, 0)).toBe("close-drawer")
    expect(swipeAction(open, "drawer", far, 0)).toBeNull()
  })

  test("rightward on the open info panel closes it", () => {
    const open = { drawer: false, info: true }
    expect(swipeAction(open, "info", far, 0)).toBe("close-info")
    expect(swipeAction(open, "info", -far, 0)).toBeNull()
    expect(swipeAction(open, "other", far, 0)).toBeNull()
  })

  test("a short or mostly vertical move is a tap or a scroll", () => {
    expect(swipeAction(shut, "edge", SWIPE_PX - 1, 0)).toBeNull()
    expect(swipeAction(shut, "edge", far, far)).toBeNull()
  })
})
