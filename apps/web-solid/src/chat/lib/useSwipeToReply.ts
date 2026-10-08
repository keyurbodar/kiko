import { createPointerListeners } from "@solid-primitives/pointer"
import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"
import { EDGE_PX } from "../../app/edge-swipe"

/* ---------------------------------------------------------------------------
   The four numbers the gesture is made of. They are tuned so a reply takes a
   flick, not a pull: the row moves on the 4th pixel and arms at 36.
   --------------------------------------------------------------------------- */

/** Furthest the row contents travel to the right, in px. */
export const SWIPE_MAX_TRAVEL_PX = 52

/** Travel at which a release arms the reply. */
export const SWIPE_REPLY_THRESHOLD_PX = 36

/** Vertical movement that hands the gesture to the scroller before the axis locks. */
export const SWIPE_AXIS_LOCK_PX = 16

/** Horizontal movement that wins the axis before anything is drawn. */
export const SWIPE_INTENT_PX = 4

const INDICATOR_SCALE_MIN = 0.4

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

  /** `travel` is how far the row has been pulled right, always >= 0. */
  const paint = (travel: number) => {
    const ratio = Math.min(1, travel / SWIPE_REPLY_THRESHOLD_PX)
    setOffset(travel)
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
        // RIGHT ONLY. A leftward drag is not a reply: it never claims the
        // axis, paints nothing, arms nothing and leaves `data-swiping` unset.
        if (dx < 0) {
          axis = "cancelled"
          return
        }
        // The first move that clears the lock is the only place the row is
        // touched, so a tap that never gets here leaves no litter behind.
        axis = "horizontal"
        setSwiping(true)
      }

      // Re-derived on every move: dragging back un-arms the gesture.
      const travel = Math.min(SWIPE_MAX_TRAVEL_PX, Math.max(0, dx))
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

const prefersReducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

/** The snap-back. Short and ease-out, so the row lands before the eye follows it. */
export const SWIPE_SETTLE_MS = 180
export const SWIPE_SETTLE_EASING = "cubic-bezier(.2,.8,.2,1)"
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
const WHEEL_SCALE = 0.3
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
        if (deltaX < 0 ? element.scrollLeft > 0 : element.scrollLeft < max - 1) return true
      }
    }
    element = element.parentElement
  }
  return false
}

/**
 * Wires the swipe gesture to a row. Two input paths share one state machine: a
 * pointer drag (mouse, touch, pen) and a trackpad two-finger swipe, which the
 * browser delivers as `wheel` events with a dominant `deltaX`. Only a RIGHTWARD
 * swipe is a reply, on any message.
 *
 * The paint is as cheap as a frame allows. The move handler only feeds the state
 * machine and asks for a frame; the frame writes one `transform` on the bubble
 * and one on the indicator, both found once when the axis is claimed. Nothing
 * reads layout, nothing re-renders, and no inherited custom property makes the
 * bubble's subtree recalculate style on every move. `will-change` is set only
 * while the row is moving, so a still transcript holds no extra layers.
 */
export function useSwipeToReply(options: UseSwipeToReplyOptions): UseSwipeToReply {
  const [row, setRow] = createSignal<HTMLElement | undefined>()
  let bubble: HTMLElement | null = null
  let indicator: HTMLElement | null = null
  let frame = 0
  let snap: Animation[] = []

  const find = () => {
    const element = row()
    if (!element) return
    bubble = element.querySelector<HTMLElement>("[data-component=chat-row] > [data-slot=bubble]")
    indicator = element.querySelector<HTMLElement>("[data-component=chat-swipe-indicator]")
  }

  const write = (travel: number) => {
    const ratio = Math.min(1, travel / SWIPE_REPLY_THRESHOLD_PX)
    const scale = INDICATOR_SCALE_MIN + (1 - INDICATOR_SCALE_MIN) * ratio
    if (bubble) bubble.style.transform = `translate3d(${travel}px,0,0)`
    if (indicator) {
      indicator.style.opacity = ratio.toFixed(3)
      indicator.style.transform = `translateY(-50%) scale(${scale.toFixed(3)})`
    }
  }

  const clear = () => {
    cancelAnimationFrame(frame)
    frame = 0
    for (const element of [bubble, indicator]) {
      if (!element) continue
      element.style.removeProperty("transform")
      element.style.removeProperty("opacity")
      element.style.removeProperty("will-change")
    }
  }

  /** Coalesces every move in a frame into one write, of the latest travel. */
  const paint = () => {
    if (frame !== 0) return
    frame = requestAnimationFrame(() => {
      frame = 0
      write(gesture.offset)
    })
  }

  const start = () => {
    for (const animation of snap) animation.cancel()
    snap = []
    find()
    if (bubble) bubble.style.willChange = "transform"
  }

  /*
   * The snap-back runs on the compositor through the Web Animations API, from
   * wherever the finger left the row to rest, in SWIPE_SETTLE_MS. The inline
   * styles are cleared first, so the animation's end state is the row's own.
   */
  const settle: SwipeSettle = (from, done) => {
    cancelAnimationFrame(frame)
    frame = 0
    if (!bubble || from === 0 || prefersReducedMotion() || typeof bubble.animate !== "function") {
      clear()
      done()
      return
    }
    const ratio = Math.min(1, from / SWIPE_REPLY_THRESHOLD_PX)
    const scale = INDICATOR_SCALE_MIN + (1 - INDICATOR_SCALE_MIN) * ratio
    const timing = { duration: SWIPE_SETTLE_MS, easing: SWIPE_SETTLE_EASING }
    clear()
    // Hold will-change through the snap so the layer is not torn down mid-flight.
    bubble.style.willChange = "transform"
    const moving = bubble.animate([{ transform: `translate3d(${from}px,0,0)` }, { transform: "translate3d(0,0,0)" }], timing)
    snap = [moving]
    if (indicator) {
      snap.push(
        indicator.animate(
          [
            { opacity: ratio, transform: `translateY(-50%) scale(${scale})` },
            { opacity: 0, transform: `translateY(-50%) scale(${INDICATOR_SCALE_MIN})` },
          ],
          timing,
        ),
      )
    }
    moving.onfinish = () => {
      snap = []
      bubble?.style.removeProperty("will-change")
      done()
    }
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
      // A touch from the screen's left edge opens the drawer (app/edge-swipe.ts), not a reply.
      if (event.pointerType === "touch" && event.clientX <= EDGE_PX) return
      activePointer = event.pointerId
      gesture.down(event.clientX, event.clientY)
    },
    onMove: (event) => {
      if (event.pointerId !== activePointer) return
      const was = gesture.swiping
      gesture.move(event.clientX, event.clientY)
      if (!gesture.swiping) return
      if (!was) start()
      capture(event)
      paint()
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
   * `travel` is exactly the x a rightward drag produces, so the axis lock, the
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
         * Engage only on a horizontal-dominant RIGHTWARD swipe (negative deltaX). Vertical
         * scrolling, inner horizontal scrollers and — as in the pointer path —
         * a leftward flick are all left entirely alone, so the only wheel
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
      const was = gesture.swiping
      gesture.move(travel, 0)
      if (gesture.swiping && !was) start()
      paint()


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

  onCleanup(() => {
    for (const animation of snap) animation.cancel()
    clear()
  })

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
