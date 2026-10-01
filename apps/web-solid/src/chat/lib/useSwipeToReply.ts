import { createPointerListeners } from "@solid-primitives/pointer"
import { animate } from "motion"
import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"

/* ---------------------------------------------------------------------------
   The four numbers the gesture is made of. They were all tuned against a
   two-handed feel on a trackpad; they are now tuned against one requirement —
   a reader should not have to think about whether a swipe is going to work.
   --------------------------------------------------------------------------- */

/**
 * Furthest the row contents travel, in px.
 *
 * 40, down from 64. The old number was 2/3 of the old 48px arm point, so the
 * row kept sliding for a third of the gesture after it had already said yes;
 * that overshoot is what read as a journey. 40 against a 28px arm point keeps
 * 12px of "past the point" slack, which is enough to feel like it caught.
 */
export const SWIPE_MAX_TRAVEL_PX = 40

/**
 * Travel at which the gesture arms the reply, released.
 *
 * 28, down from 48. 48px is roughly the width of a two-finger trackpad sweep
 * and well past what a thumb produces in one lateral flick, so it demanded a
 * deliberate shove. 28 is a thumb flick; below ~24 the scroller's own residual
 * jitter starts tripping it.
 */
export const SWIPE_REPLY_THRESHOLD_PX = 24

/**
 * Vertical movement that loses the axis to the scroller before the lock closes.
 *
 * 16, down from 20. This is the one guard standing between a vertical scroll
 * and a stolen gesture, and it has to stay: a real scroll passes 16px inside a
 * single frame. It came down only because it is measured against the arm point
 * — at 20px a flick angled as shallowly as 55° was cancelled before it could
 * reach a 28px travel.
 */
export const SWIPE_AXIS_LOCK_PX = 16

/**
 * Horizontal movement that wins the axis before anything is drawn.
 *
 * 6, down from 8. This is the dead zone at the start of every drag, and a
 * trackpad's very first event already carries more than 6px, so the smaller
 * value costs nothing in false positives — a resting finger moves 1-2px.
 */
export const SWIPE_INTENT_PX = 6

const INDICATOR_SCALE_MIN = 0.55

type Axis = "pending" | "horizontal" | "cancelled"

/** Drives one number back to zero and reports when it got there. */
export type SwipeSettle = (from: number, done: () => void) => void

export interface SwipeGestureOptions {
  /** Snap-back. Runs on release before `onReply`, and blocks further moves. */
  settle: SwipeSettle
  onReply: () => void
}

/**
 * The swipe state machine with no DOM in it: feed it pointer coordinates and it
 * decides what the row should look like. Every visual change happens on the
 * first move that clears the axis lock, so a tap that never moves is a no-op.
 */
export interface SwipeGesture {
  down: (x: number, y: number) => void
  move: (x: number, y: number) => void
  release: () => void
  cancel: () => void
  readonly swiping: boolean
  readonly offset: number
  readonly progress: number
  readonly scale: number
}

export function createSwipeGesture(options: SwipeGestureOptions): SwipeGesture {
  let axis: Axis = "cancelled"
  let originX = 0
  let originY = 0
  let settling = false
  let armed = false

  const [swiping, setSwiping] = createSignal(false)
  const [offset, setOffset] = createSignal(0)
  const [progress, setProgress] = createSignal(0)
  const [scale, setScale] = createSignal(INDICATOR_SCALE_MIN)

  /** `travel` is how far the row has been pulled left, always >= 0. */
  const paint = (travel: number) => {
    const ratio = Math.min(1, travel / SWIPE_REPLY_THRESHOLD_PX)
    // `travel > 0` rather than a bare `-travel`: at rest this has to be a plain
    // zero, and `-0` is a different number that serialises into `--swipe-x` as
    // `-0px`.
    setOffset(travel > 0 ? -travel : 0)
    setProgress(ratio)
    setScale(INDICATOR_SCALE_MIN + (1 - INDICATOR_SCALE_MIN) * ratio)
  }

  const reset = () => {
    axis = "cancelled"
    settling = false
    armed = false
    setSwiping(false)
    setOffset(0)
    setProgress(0)
    setScale(INDICATOR_SCALE_MIN)
  }

  return {
    get swiping() {
      return swiping()
    },
    get offset() {
      return offset()
    },
    get progress() {
      return progress()
    },
    get scale() {
      return scale()
    },
    down(x, y) {
      settling = false
      armed = false
      axis = "pending"
      originX = x
      originY = y
    },
    move(x, y) {
      if (settling || axis === "cancelled") return
      const dx = x - originX
      const dy = y - originY

      if (axis === "pending") {
        if (Math.abs(dy) > SWIPE_AXIS_LOCK_PX) {
          axis = "cancelled"
          return
        }
        if (Math.abs(dx) < SWIPE_INTENT_PX) return
        /*
         * LEFT ONLY.
         *
         * A rightward drag is not a reply, so it never claims the axis at all:
         * cancelling here — rather than claiming it and then ignoring the
         * travel — is what keeps the promise that a right drag paints nothing,
         * arms nothing, and leaves `data-swiping` unset. It also means the row
         * is never handed to the snap-back for a drag the reader did not make,
         * so there is nothing to spring home afterwards.
         *
         * The gesture is deliberately NOT handed the rightward drag as a scroll:
         * the transcript scroller is `overflow-x-hidden`, so there is no
         * horizontal scroll to hand it to, and inventing one would be scope the
         * transcript does not have. Inert is the honest answer.
         */
        if (dx > 0) {
          axis = "cancelled"
          return
        }
        // The first move that clears the lock is the only place the row is
        // touched, so a tap that never gets here leaves no litter behind.
        axis = "horizontal"
        setSwiping(true)
      }

      /*
       * Travel is leftward distance only, and it is re-derived on every move
       * rather than latched at the claim: a reader who overshoots and drags
       * back has genuinely un-armed the gesture, and the row follows them back
       * to zero instead of staying parked at the overshoot.
       */
      const travel = Math.min(SWIPE_MAX_TRAVEL_PX, Math.max(0, -dx))
      armed = travel >= SWIPE_REPLY_THRESHOLD_PX
      paint(travel)
    },
    release() {
      if (axis !== "horizontal") {
        reset()
        return
      }
      settling = true
      /*
       * The reply is committed NOW, synchronously — not from `settle`'s
       * completion callback, which is where it used to live.
       *
       * `settle` runs the row's snap-back, so committing inside its callback
       * meant the composer's reply bar could not appear until the row had
       * finished animating home. That is the whole of the lag: a gesture the
       * reader had already completed, followed by a quarter second in which
       * nothing acknowledged it. The two are independent — the row animates
       * back to rest while the bar is already up — and nothing downstream
       * reads the row's transform, so there is no ordering to preserve.
       */
      if (armed) options.onReply()
      options.settle(offset(), reset)
    },
    cancel() {
      if (axis !== "horizontal") {
        reset()
        return
      }
      settling = true
      options.settle(offset(), reset)
    },
  }
}

export interface UseSwipeToReplyOptions {
  onReply: () => void
}

/** The row attributes the gesture owns, ready to spread onto the row element. */
export interface SwipeRowHandlers {
  ref: (element: HTMLElement) => void
  "data-swiping": true | undefined
}

export interface UseSwipeToReply {
  swiping: Accessor<boolean>
  offset: Accessor<number>
  progress: Accessor<number>
  scale: Accessor<number>
  handlers: SwipeRowHandlers
}

const clamp = (value: number) => Math.max(-SWIPE_MAX_TRAVEL_PX, Math.min(SWIPE_MAX_TRAVEL_PX, value))

/* ---------------------------------------------------------------------------
   Trackpad swipe.
   
   On a laptop there is no drag to begin: two fingers on the trackpad deliver
   `wheel` events with a dominant `deltaX`, and the message under the pointer is
   only ever hovered. tweb drives its reply swipe from exactly these events, so a
   pointer-only gesture is unusable with a trackpad — which is what "you have to
   click the message first" means.

   These are tweb's own constants, kept because the feel is calibrated: the delta
   is scaled down to match the touch throw, and the end of the gesture is guessed
   rather than signalled, since the browser exposes no "fingers lifted".
   --------------------------------------------------------------------------- */
/** Wheel delta is scaled down so a trackpad throw matches the touch throw. */
const WHEEL_SCALE = 0.25
/** Wheel silence that means the gesture is over. Also the no-momentum commit delay. */
const WHEEL_IDLE_MS = 75
/**
 * Inertia detection. A trackpad keeps firing decaying `wheel` events for about a
 * second after the fingers lift. It must be strict: the brief slow-down at the
 * end of an active push decays too, so a short streak would commit while the
 * fingers are still down. Eight consecutive decaying events, past a real flick's
 * peak, is longer than any plausible finger ease-out.
 */
const INERTIA_DECEL_EVENTS = 8
const INERTIA_PEAK_RATIO = 0.7
const INERTIA_MIN_PEAK = 12
/** A jump past this fraction of the last delta is a finger pushing again. */
const INERTIA_REACCEL_RATIO = 1.2

/**
 * True when an element between the target and the row can still scroll in the
 * swipe's direction, in which case the swipe must not steal the gesture — a code
 * block or a wide table keeps its own horizontal scroll.
 */
function innerScrollsToward(from: EventTarget | null, stop: HTMLElement, deltaX: number) {
  let element = from instanceof HTMLElement ? from : null
  while (element !== null && element !== stop) {
    if (element.scrollWidth > element.clientWidth) {
      const overflow = getComputedStyle(element).overflowX
      if (overflow === "auto" || overflow === "scroll") {
        const max = element.scrollWidth - element.clientWidth
        if (deltaX > 0 ? element.scrollLeft > 0 : element.scrollLeft < max - 1) return true
      }
    }
    element = element.parentElement
  }
  return false
}

/**
 * Wires the swipe gesture to a row. Two input paths share one state machine: a
 * pointer drag (mouse, touch, pen) and a trackpad two-finger swipe, which the
 * browser delivers as `wheel` events with a dominant `deltaX`. Only a LEFTWARD
 * swipe is a reply, on any message; the row's `--swipe-x`, `--swipe-progress`
 * and `--swipe-scale` come out, written straight to the custom properties
 * rather than through a style binding, so the contents translate on the
 * compositor.
 */
export function useSwipeToReply(options: UseSwipeToReplyOptions): UseSwipeToReply {
  const [row, setRow] = createSignal<HTMLElement | undefined>()

  const clear = () => {
    const element = row()
    if (!element) return
    element.style.removeProperty("--swipe-x")
    element.style.removeProperty("--swipe-progress")
    element.style.removeProperty("--swipe-scale")
  }

  const paint = (offset: number) => {
    const element = row()
    if (!element) return
    const ratio = Math.min(1, Math.abs(offset) / SWIPE_REPLY_THRESHOLD_PX)
    element.style.setProperty("--swipe-x", `${clamp(offset)}px`)
    element.style.setProperty("--swipe-progress", ratio.toFixed(4))
    element.style.setProperty("--swipe-scale", (INDICATOR_SCALE_MIN + (1 - INDICATOR_SCALE_MIN) * ratio).toFixed(4))
  }

  const settle: SwipeSettle = (from, done) => {
    if (!row() || from === 0) {
      clear()
      done()
      return
    }
    const controls = animate(from, 0, {
      type: "spring",
      stiffness: 520,
      damping: 40,
      mass: 0.7,
      restDelta: 0.4,
      onUpdate: (value: number) => paint(value),
      onComplete: () => {
        controls.stop()
        clear()
        done()
      },
    })
  }

  const gesture = createSwipeGesture({ settle, onReply: options.onReply })

  /*
   * The pointer path.
   *
   * `@solid-primitives/pointer` attaches pointerdown/move/up to the ROW element
   * and does not capture the pointer, so the browser retargets every event to
   * whatever is under the cursor instead. That is the whole of "it is hard to
   * swipe". Measured on the composed app: a 46px bubble sitting at x=1206-1252
   * inside a row spanning x=500-1268 — start a leftward drag at x=538, a third
   * of the way across the row and 668px from the bubble, and by the time the
   * travel was 30px the cursor had left the row entirely. Both the remaining
   * `pointermove` and the `pointerup` went to the scroller, so the gesture never
   * saw its own release: no reply, and the row stranded at `--swipe-x: -30px`
   * because the snap-back that would have undone it was never asked for. The
   * grab area was always the full row; it just stopped listening as soon as the
   * cursor left it, which is the same thing as a short grab area from the
   * reader's side.
   *
   * Capturing is what makes the row the event target for the rest of the drag.
   * It happens on the move that CLAIMS the axis, not on pointerdown, and that
   * ordering is load-bearing: capturing at pointerdown would retarget the
   * compatibility mouse events too, so a click on a link inside a bubble would
   * land on the row instead of the link. Waiting until the row is actually
   * moving means a plain click never captures anything and behaves exactly as it
   * did before.
   */
  let captured = false
  let activePointer: number | undefined
  const capture = (event: PointerEvent) => {
    if (captured) return
    const element = row()
    if (!element) return
    element.setPointerCapture(event.pointerId)
    captured = true
  }
  createPointerListeners({
    target: row,
    pointerTypes: ["mouse", "touch", "pen"],
    onDown: (event) => {
      if (event.button !== 0) return
      activePointer = event.pointerId
      gesture.down(event.clientX, event.clientY)
    },
    onMove: (event) => {
      if (event.pointerId !== activePointer) return
      gesture.move(event.clientX, event.clientY)
      if (!gesture.swiping) return
      capture(event)
      paint(gesture.offset)
    },
    onUp: (event) => {
      if (event.pointerId !== activePointer) return
      activePointer = undefined
      captured = false
      gesture.release()
    },
    onCancel: (event) => {
      if (event.pointerId !== activePointer) return
      activePointer = undefined
      captured = false
      gesture.cancel()
    },
  })

  /*
   * The trackpad path. It drives the SAME state machine as the pointer path, by
   * feeding it synthetic coordinates rather than by growing a second machine:
   * `-travel` is exactly the x a leftward drag produces, so the axis lock, the
   * arming threshold, the snap-back and the commit stay in one place.
   *
   * The gesture ends when the wheel goes quiet, or when the deltas are seen to
   * decay into inertia, which is how we learn the fingers have lifted.
   */
  createEffect(() => {
    const element = row()
    if (!element) return

    let axis: "x" | "passive" | undefined
    let travel = 0
    let gesturing = false
    let released = false
    let idleTimer: number | undefined
    let prevAbs = -1
    let peakAbs = 0
    let decel = 0

    const finish = () => {
      if (!gesturing) return
      gesturing = false
      gesture.release()
    }
    const scheduleIdle = () => {
      clearTimeout(idleTimer)
      idleTimer = window.setTimeout(() => {
        idleTimer = undefined
        finish()
        axis = undefined
        travel = 0
        released = false
        prevAbs = -1
        peakAbs = 0
        decel = 0
      }, WHEEL_IDLE_MS)
    }


    const onWheel = (event: WheelEvent) => {
      // Pinch-zoom, or a mouse wheel held sideways with shift. Both put the
      // horizontal movement on deltaX, and neither is a trackpad swipe.
      if (event.ctrlKey || event.metaKey || event.shiftKey) return

      // Line- and page-mode deltas come from tilt wheels; normalise to pixels.
      const raw =
        event.deltaMode === 1
          ? event.deltaX * 16
          : event.deltaMode === 2
            ? event.deltaX * element.clientWidth
            : event.deltaX

      if (axis === undefined) {
        /*
         * Engage only on a horizontal-dominant LEFTWARD swipe. Vertical
         * scrolling, inner horizontal scrollers and — per the pointer path —
         * a rightward flick are all left entirely alone, so the only wheel
         * gesture claimed is a deliberately sideways one that means something
         * here. Nothing is prevented on the way out, so whatever the reader
         * would have done with the others still happens.
         */
        if (
          raw >= 0 ||
          Math.abs(raw) <= Math.abs(event.deltaY) ||
          innerScrollsToward(event.target, element, raw)
        ) {
          axis = "passive"
          scheduleIdle()
          return
        }
        axis = "x"
        travel = 0
        prevAbs = -1
        peakAbs = 0
        decel = 0
        released = false
        gesturing = true
        gesture.down(0, 0)
      }

      if (axis === "passive") {
        scheduleIdle()
        return
      }

      // Ours now: stop the transcript scrolling sideways under the swipe.
      event.preventDefault()

      // The fingers already lifted; swallow the decaying momentum tail so its
      // jitter cannot nudge the bubble or start a second gesture.
      if (released) {
        scheduleIdle()
        return
      }

      travel = Math.max(0, Math.min(SWIPE_MAX_TRAVEL_PX, travel + Math.abs(raw) * WHEEL_SCALE))
      gesture.move(-travel, 0)
      paint(gesture.offset)


      // Magnitude trend, to spot the coast. A real coast decays smoothly with
      // only tiny up-jitter; a finger pushing again is a clear jump, and only
      // that clears the streak.
      const abs = Math.abs(raw)
      if (abs > peakAbs) peakAbs = abs
      if (prevAbs >= 0) {
        if (abs < prevAbs) ++decel
        else if (abs > prevAbs * INERTIA_REACCEL_RATIO) decel = 0
      }
      prevAbs = abs

      if (
        peakAbs >= INERTIA_MIN_PEAK &&
        decel >= INERTIA_DECEL_EVENTS &&
        abs < peakAbs * INERTIA_PEAK_RATIO
      ) {
        released = true
        finish()
      }

      scheduleIdle()
    }

    element.addEventListener("wheel", onWheel, { passive: false, capture: true })
    onCleanup(() => {
      element.removeEventListener("wheel", onWheel, { capture: true })
      clearTimeout(idleTimer)
    })
  })

  onCleanup(clear)

  const handlers: SwipeRowHandlers = {
    ref: (element) => setRow(() => element),
    get "data-swiping"() {
      return gesture.swiping ? true : undefined
    },
  }

  return {
    swiping: () => gesture.swiping,
    offset: () => gesture.offset,
    progress: () => gesture.progress,
    scale: () => gesture.scale,
    handlers,
  }
}
