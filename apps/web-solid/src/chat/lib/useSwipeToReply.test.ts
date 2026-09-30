import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import {
  SWIPE_MAX_TRAVEL_PX,
  SWIPE_REPLY_THRESHOLD_PX,
  createSwipeGesture,
  type SwipeGesture,
} from "./useSwipeToReply"

interface Harness {
  gesture: SwipeGesture
  replies: number[]
  /** Travel handed to the snap-back, in call order. */
  settles: number[]
}

function harness(): Harness {
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
      settle,
      onReply: () => replies.push(replies.length),
    })
    return { gesture, replies, settles }
  }) as Harness
}

/**
 * Drags from the origin in one step. `travel` carries its own sign: positive is
 * a rightward drag, negative a leftward one. Both are valid replies.
 */
function drag(gesture: SwipeGesture, travel: number, rise = 0) {
  gesture.down(0, 0)
  gesture.move(travel, rise)
}

describe("swipe to reply", () => {
  test("fires the reply at 48px of travel", () => {
    const { gesture, replies } = harness()
    drag(gesture, SWIPE_REPLY_THRESHOLD_PX)
    expect(gesture.offset).toBe(48)
    expect(gesture.progress).toBe(1)
    gesture.release()
    expect(replies).toHaveLength(1)
  })

  test("does not fire one pixel short of the threshold", () => {
    const { gesture, replies, settles } = harness()
    drag(gesture, SWIPE_REPLY_THRESHOLD_PX - 1)
    expect(gesture.offset).toBe(47)
    expect(gesture.progress).toBeCloseTo(47 / SWIPE_REPLY_THRESHOLD_PX, 5)
    gesture.release()
    expect(replies).toHaveLength(0)
    // It still settles: the row had visibly moved and has to come back.
    expect(settles).toEqual([47])
  })

  test("fires once even if the release is delivered twice", () => {
    const { gesture, replies } = harness()
    drag(gesture, 60)
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
    drag(gesture, 200)
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

  test("either direction replies, whichever side sent the message", () => {
    // Direction is the reader's, not the sender's. A leftward swipe used to be
    // discarded on the agent's row, which reads as a dead gesture because
    // nothing on screen says which way a row is allowed to move.
    const right = harness()
    drag(right.gesture, 50)
    expect(right.gesture.offset).toBe(50)
    expect(right.gesture.side).toBe("start")
    right.gesture.release()
    expect(right.replies).toHaveLength(1)

    const left = harness()
    drag(left.gesture, -50)
    expect(left.gesture.offset).toBe(-50)
    expect(left.gesture.side).toBe("end")
    left.gesture.release()
    expect(left.replies).toHaveLength(1)
  })

  test("the indicator edge follows the drag, not the message", () => {
    const { gesture } = harness()
    drag(gesture, 30)
    expect(gesture.side).toBe("start")

    const other = harness()
    other.gesture.down(0, 0)
    other.gesture.move(-30, 0)
    expect(other.gesture.side).toBe("end")
  })

  test("a cancelled gesture settles back but never replies", () => {
    const { gesture, replies, settles } = harness()
    drag(gesture, 55)
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
    drag(gesture, 50)
    gesture.release()
    expect(settles).toEqual([50])
    drag(gesture, 20)
    expect(gesture.swiping).toBe(true)
    expect(gesture.offset).toBe(20)
    gesture.release()
    expect(replies).toEqual([0])
    expect(settles).toEqual([50, 20])
  })
})
