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
 * Drags from the origin in one step. `travel` carries its own sign: negative is
 * a leftward drag, which is the only one that replies; positive is a rightward
 * drag, which is inert.
 */
function drag(gesture: SwipeGesture, travel: number, rise = 0) {
  gesture.down(0, 0)
  gesture.move(travel, rise)
}

describe("swipe to reply", () => {
  test("fires the reply at 28px of leftward travel", () => {
    const { gesture, replies } = harness()
    drag(gesture, -SWIPE_REPLY_THRESHOLD_PX)
    expect(gesture.offset).toBe(-28)
    expect(gesture.progress).toBe(1)
    gesture.release()
    expect(replies).toHaveLength(1)
  })

  test("does not fire one pixel short of the threshold", () => {
    const { gesture, replies, settles } = harness()
    drag(gesture, -(SWIPE_REPLY_THRESHOLD_PX - 1))
    expect(gesture.offset).toBe(-27)
    expect(gesture.progress).toBeCloseTo(27 / SWIPE_REPLY_THRESHOLD_PX, 5)
    gesture.release()
    expect(replies).toHaveLength(0)
    // It still settles: the row had visibly moved and has to come back.
    expect(settles).toEqual([-27])
  })

  test("a rightward drag is inert: it never arms, paints, or settles", () => {
    const { gesture, replies, settles } = harness()
    gesture.down(0, 0)
    gesture.move(SWIPE_MAX_TRAVEL_PX, 0)
    gesture.move(SWIPE_MAX_TRAVEL_PX * 4, 0)
    expect(gesture.swiping).toBe(false)
    expect(gesture.offset).toBe(0)
    expect(gesture.progress).toBe(0)
    gesture.release()
    expect(replies).toHaveLength(0)
    // Nothing moved, so there is nothing to spring home.
    expect(settles).toEqual([])
  })

  test("a rightward drag cannot be walked back into a left swipe", () => {
    // The axis is claimed, not latched: once a drag has gone right it is
    // finished. Letting it recover would mean the reader's first 6px decided
    // nothing, and a gesture that appears to start twice is harder to trust
    // than one that is simply refused.
    const { gesture, replies, settles } = harness()
    gesture.down(0, 0)
    gesture.move(10, 0)
    gesture.move(-60, 0)
    expect(gesture.swiping).toBe(false)
    gesture.release()
    expect(replies).toHaveLength(0)
    expect(settles).toEqual([])
  })

  test("dragging back past the origin un-arms and returns the row to rest", () => {
    const { gesture, replies, settles } = harness()
    gesture.down(0, 0)
    gesture.move(-SWIPE_MAX_TRAVEL_PX, 0)
    expect(gesture.offset).toBe(-SWIPE_MAX_TRAVEL_PX)
    gesture.move(-5, 0)
    expect(gesture.offset).toBe(-5)
    gesture.move(0, 0)
    expect(gesture.offset).toBe(0)
    gesture.release()
    expect(replies).toHaveLength(0)
    // The row is already home, so `settle` is handed a zero — which is the
    // signal the DOM layer short-circuits on, so nothing animates.
    expect(settles).toEqual([0])
  })

  test("fires once even if the release is delivered twice", () => {
    const { gesture, replies } = harness()
    drag(gesture, -60)
    gesture.release()
    gesture.release()
    expect(replies).toHaveLength(1)
  })

  /*
   * The reply is committed ON RELEASE, synchronously — not after the snap-back.
   *
   * This assertion used to be its opposite ("fires after the snap-back, not
   * during it"), which pinned the snap-back's completion callback as the only
   * place a reply could be armed. That is a real, visible defect rather than a
   * style choice: the row has to finish travelling home before the composer's
   * reply bar appears, so a completed gesture is followed by a quarter second
   * in which nothing acknowledges it. What matters to a reader is that the
   * gesture they just finished is answered at once; the row's transform and the
   * composer's state are independent and nothing downstream reads the former.
   *
   * The test keeps its shape — order, not timing — so it still fails if anyone
   * re-couples the two.
   */
  test("commits the reply on release, without waiting for the snap-back", () => {
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
    g.move(-50, 0)
    g.release()
    expect(order).toEqual(["reply", "settle"])
    // And the snap-back finishing must not fire it a second time.
    settleDone?.()
    expect(order).toEqual(["reply", "settle"])
  })

  test("travel caps at 40px and the progress stops at 1", () => {
    const { gesture } = harness()
    drag(gesture, -200)
    expect(gesture.offset).toBe(-SWIPE_MAX_TRAVEL_PX)
    expect(gesture.progress).toBe(1)
    expect(gesture.scale).toBe(1)
  })

  test("the arm point is a third of the row's total travel", () => {
    // The whole feel of the gesture is the ratio: how much of the available
    // travel is dead, and how much of it is overshoot after it has said yes.
    expect(SWIPE_REPLY_THRESHOLD_PX / SWIPE_MAX_TRAVEL_PX).toBeCloseTo(0.7, 2)
  })

  test("a vertical-first gesture never fires and never claims the axis", () => {
    const { gesture, replies, settles } = harness()
    gesture.down(0, 0)
    gesture.move(-4, 21)
    expect(gesture.swiping).toBe(false)
    // The scroller took the gesture; every later move is ignored, including a
    // long leftward one.
    gesture.move(-90, 21)
    expect(gesture.swiping).toBe(false)
    expect(gesture.offset).toBe(0)
    gesture.release()
    expect(replies).toHaveLength(0)
    expect(settles).toEqual([])
  })

  test("exactly 16px of vertical drift still leaves the axis undecided", () => {
    const { gesture } = harness()
    gesture.down(0, 0)
    gesture.move(-4, 16)
    gesture.move(-SWIPE_MAX_TRAVEL_PX, 16)
    expect(gesture.swiping).toBe(true)
    expect(gesture.offset).toBe(-SWIPE_MAX_TRAVEL_PX)
  })

  test("a 17px vertical drift hands the gesture to the scroller", () => {
    const { gesture, replies } = harness()
    gesture.down(0, 0)
    gesture.move(-4, 17)
    gesture.move(-60, 17)
    expect(gesture.swiping).toBe(false)
    gesture.release()
    expect(replies).toHaveLength(0)
  })

  test("a shallow flick clears the lock on angle, not on effort", () => {
    // The lock exists to stop a vertical scroll being stolen, and it is
    // measured as an absolute vertical allowance. This pins the consequence:
    // a 30-degree flick is inside it, so it replies, while a scroll-sized
    // vertical run never gets that far.
    const flick = harness()
    flick.gesture.down(0, 0)
    flick.gesture.move(-28, 16)
    expect(flick.gesture.swiping).toBe(true)
    flick.gesture.release()
    expect(flick.replies).toHaveLength(1)
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

  test("a leftward swipe replies on the reader's own row and the agent's", () => {
    // Which way a row is allowed to move is a property of the gesture, not of
    // who sent the message. An earlier design gated each direction to one
    // sender, so a leftward swipe was silently discarded on the agent's row —
    // a dead gesture, because nothing on screen said which rows were allowed
    // to move. One direction, every row.
    for (const travel of [-30, -90]) {
      const { gesture, replies } = harness()
      drag(gesture, travel)
      expect(gesture.offset).toBe(travel > -SWIPE_MAX_TRAVEL_PX ? travel : -SWIPE_MAX_TRAVEL_PX)
      gesture.release()
      expect(replies).toHaveLength(1)
    }
  })

  test("a cancelled gesture settles back but never replies", () => {
    const { gesture, replies, settles } = harness()
    drag(gesture, -35)
    expect(gesture.swiping).toBe(true)
    gesture.cancel()
    expect(replies).toHaveLength(0)
    expect(settles).toEqual([-35])
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
    g.move(-35, 0)
    g.release()
    g.move(0, 0)
    expect(g.offset).toBe(-35)
    pending?.()
    expect(g.offset).toBe(0)
    expect(g.swiping).toBe(false)
  })

  test("a second gesture starts from rest", () => {
    const { gesture, replies, settles } = harness()
    drag(gesture, -35)
    gesture.release()
    expect(settles).toEqual([-35])
    drag(gesture, -20)
    expect(gesture.swiping).toBe(true)
    expect(gesture.offset).toBe(-20)
    gesture.release()
    expect(settles).toEqual([-35, -20])

  })
})
