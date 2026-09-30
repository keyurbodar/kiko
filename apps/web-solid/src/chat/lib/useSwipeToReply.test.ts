import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import {
  SWIPE_MAX_TRAVEL_PX,
  SWIPE_REPLY_THRESHOLD_PX,
  createSwipeGesture,
  type SwipeGesture,
  type SwipeSide,
} from "./useSwipeToReply"

interface Harness {
  gesture: SwipeGesture
  replies: number[]
  /** Travel handed to the snap-back, in call order. */
  settles: number[]
}

function harness(side: SwipeSide = "bot"): Harness {
  return createRoot(() => {
    const replies: number[] = []
    const settles: number[] = []
    // An instant snap-back: the gesture's contract is *when* it settles and
    // fires, not how the spring is tuned.
    const settle = (from: number, done: () => void) => {
      settles.push(from)
      done()
    }
    const gesture = createSwipeGesture({
      side: () => side,
      settle,
      onReply: () => replies.push(replies.length),
    })
    return { gesture, replies, settles }
  }) as Harness
}

/** Drags from the origin in the direction that suits `side`, in one step. */
function drag(gesture: SwipeGesture, side: SwipeSide, travel: number, rise = 0) {
  const sign = side === "bot" ? 1 : -1
  gesture.down(0, 0)
  gesture.move(travel * sign, rise)
}

describe("swipe to reply", () => {
  test("fires the reply at 48px of travel", () => {
    const { gesture, replies } = harness()
    drag(gesture, "bot", SWIPE_REPLY_THRESHOLD_PX)
    expect(gesture.offset).toBe(48)
    expect(gesture.progress).toBe(1)
    gesture.release()
    expect(replies).toHaveLength(1)
  })

  test("does not fire one pixel short of the threshold", () => {
    const { gesture, replies, settles } = harness()
    drag(gesture, "bot", SWIPE_REPLY_THRESHOLD_PX - 1)
    expect(gesture.offset).toBe(47)
    expect(gesture.progress).toBeCloseTo(47 / SWIPE_REPLY_THRESHOLD_PX, 5)
    gesture.release()
    expect(replies).toHaveLength(0)
    // It still settles: the row had visibly moved and has to come back.
    expect(settles).toEqual([47])
  })

  test("fires once even if the release is delivered twice", () => {
    const { gesture, replies } = harness()
    drag(gesture, "bot", 60)
    gesture.release()
    gesture.release()
    expect(replies).toHaveLength(1)
  })

  test("fires after the snap-back, not during it", () => {
    const order: string[] = []
    let settleDone: (() => void) | undefined
    let gesture: SwipeGesture
    createRoot(() => {
      gesture = createSwipeGesture({
        side: () => "bot" as SwipeSide,
        settle: (_from, done) => {
          order.push("settle")
          settleDone = done
        },
        onReply: () => order.push("reply"),
      })
    }) as unknown as { gesture: SwipeGesture }
    const g = gesture!
    g.down(0, 0)
    g.move(50, 0)
    g.release()
    expect(order).toEqual(["settle"])
    settleDone?.()
    expect(order).toEqual(["settle", "reply"])
  })

  test("travel caps at 64px and the progress stops at 1", () => {
    const { gesture } = harness()
    drag(gesture, "bot", 200)
    expect(gesture.offset).toBe(SWIPE_MAX_TRAVEL_PX)
    expect(gesture.progress).toBe(1)
    expect(gesture.scale).toBe(1)
  })

  test("a vertical-first gesture never fires and never claims the axis", () => {
    const { gesture, replies, settles } = harness()
    gesture.down(0, 0)
    gesture.move(4, 21)
    expect(gesture.swiping).toBe(false)
    // The scroller took the gesture; every later move is ignored, including a
    // long horizontal one.
    gesture.move(90, 21)
    expect(gesture.swiping).toBe(false)
    expect(gesture.offset).toBe(0)
    gesture.release()
    expect(replies).toHaveLength(0)
    expect(settles).toEqual([])
  })

  test("exactly 20px of vertical drift still leaves the axis undecided", () => {
    const { gesture } = harness()
    gesture.down(0, 0)
    gesture.move(4, 20)
    gesture.move(60, 20)
    expect(gesture.swiping).toBe(true)
    expect(gesture.offset).toBe(60)
  })

  test("a tap leaves the row untouched", () => {
    const { gesture, replies, settles } = harness()
    gesture.down(100, 100)
    gesture.move(102, 101)
    expect(gesture.swiping).toBe(false)
    expect(gesture.offset).toBe(0)
    expect(gesture.progress).toBe(0)
    expect(gesture.scale).toBeLessThan(1)
    gesture.release()
    expect(replies).toHaveLength(0)
    expect(settles).toEqual([])
    expect(gesture.swiping).toBe(false)
  })

  test("the viewer's row swipes left and the agent's swipes right", () => {
    const viewer = harness("user")
    drag(viewer.gesture, "user", 50)
    expect(viewer.gesture.offset).toBe(-50)
    viewer.gesture.release()
    expect(viewer.replies).toHaveLength(1)

    const agent = harness("bot")
    drag(agent.gesture, "bot", 50)
    expect(agent.gesture.offset).toBe(50)
  })

  test("swiping against the indicator's side is a miss, not a reply", () => {
    const { gesture, replies, settles } = harness("user")
    gesture.down(0, 0)
    // The viewer's indicator sits on the right, so the row must be dragged
    // left; dragging it right is an ordinary text selection.
    gesture.move(50, 0)
    expect(gesture.swiping).toBe(false)
    gesture.release()
    expect(replies).toHaveLength(0)
    expect(settles).toEqual([])
  })
  test("a cancelled gesture settles back but never replies", () => {
    const { gesture, replies, settles } = harness()
    drag(gesture, "bot", 55)
    expect(gesture.swiping).toBe(true)
    gesture.cancel()
    expect(replies).toHaveLength(0)
    expect(settles).toEqual([55])
    expect(gesture.swiping).toBe(false)
    expect(gesture.offset).toBe(0)
  })

  test("moves during the snap-back are ignored", () => {
    let pending: (() => void) | undefined
    let gesture: SwipeGesture
    createRoot(() => {
      gesture = createSwipeGesture({
        side: () => "bot" as SwipeSide,
        settle: (_from, done) => {
          pending = done
        },
        onReply: () => {},
      })
    }) as unknown as { gesture: SwipeGesture }
    const g = gesture!
    g.down(0, 0)
    g.move(55, 0)
    g.release()
    g.move(0, 0)
    expect(g.offset).toBe(55)
    pending?.()
    expect(g.offset).toBe(0)
    expect(g.swiping).toBe(false)
  })

  test("a second gesture starts from rest", () => {
    const { gesture, replies, settles } = harness()
    drag(gesture, "bot", 50)
    gesture.release()
    expect(settles).toEqual([50])
    drag(gesture, "bot", 20)
    expect(gesture.swiping).toBe(true)
    expect(gesture.offset).toBe(20)
    gesture.release()
    expect(replies).toEqual([0])
    expect(settles).toEqual([50, 20])
  })
})
