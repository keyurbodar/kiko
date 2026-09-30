import { createPointerListeners } from "@solid-primitives/pointer"
import { animate } from "motion"
import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"

/** Furthest the row contents travel, in px. */
export const SWIPE_MAX_TRAVEL_PX = 64
/** Travel at which the gesture arms the reply, released. */
export const SWIPE_REPLY_THRESHOLD_PX = 48
/** Vertical movement that loses the axis to the scroller before the lock closes. */
export const SWIPE_AXIS_LOCK_PX = 20
/** Horizontal movement that wins the axis before anything is drawn. */
export const SWIPE_INTENT_PX = 8

const INDICATOR_SCALE_MIN = 0.55

/**
 * Which edge the indicator sits on once a gesture is under way.
 *
 * It is derived from the DIRECTION OF THE DRAG, never from who sent the message.
 * An earlier design gated each side to one direction — the agent's row rightward,
 * the viewer's leftward — which meant a leftward swipe on the agent's message was
 * silently discarded. That reads as a broken gesture, because nothing on screen
 * says which way a given row is allowed to move. The content now travels whichever
 * way the reader swipes and the indicator is revealed behind it: `start` is the
 * left edge, `end` the right.
 */
export type SwipeSide = "start" | "end"

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
  /** The edge the indicator belongs on, from the live drag direction. */
  readonly side: SwipeSide
}

export function createSwipeGesture(options: SwipeGestureOptions): SwipeGesture {
  let axis: Axis = "cancelled"
  let originX = 0
  let originY = 0
  let settling = false
  let armed = false
  /** Which way the content is travelling. Fixed on the move that claims the axis. */
  let direction: 1 | -1 = 1

  const [swiping, setSwiping] = createSignal(false)
  const [offset, setOffset] = createSignal(0)
  const [progress, setProgress] = createSignal(0)
  const [scale, setScale] = createSignal(INDICATOR_SCALE_MIN)
  const [side, setSide] = createSignal<SwipeSide>("start")

  const paint = (travel: number) => {
    const ratio = Math.min(1, travel / SWIPE_REPLY_THRESHOLD_PX)
    setOffset(direction * travel)
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
    get side() {
      return side()
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
        // The first move that clears the lock decides the direction, and with it
        // which edge the indicator is revealed on. Either way is a valid reply,
        // so there is no wrong direction to reject.
        direction = dx > 0 ? 1 : -1
        setSide(dx > 0 ? "start" : "end")
        // The first move that clears the lock is the only place the row is
        // touched, so a tap that never gets here leaves no litter behind.
        axis = "horizontal"
        setSwiping(true)
      }

      const travel = Math.min(SWIPE_MAX_TRAVEL_PX, Math.abs(dx))
      armed = travel >= SWIPE_REPLY_THRESHOLD_PX
      paint(travel)
    },
    release() {
      if (axis !== "horizontal") {
        reset()
        return
      }
      const shouldReply = armed
      settling = true
      options.settle(offset(), () => {
        reset()
        if (shouldReply) options.onReply()
      })
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
  "data-swipe-side": SwipeSide
}

export interface UseSwipeToReply {
  swiping: Accessor<boolean>
  offset: Accessor<number>
  progress: Accessor<number>
  scale: Accessor<number>
  indicatorSide: Accessor<SwipeSide>
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
 * browser delivers as `wheel` events with a dominant `deltaX`. Neither direction
 * is privileged, so any deliberate horizontal swipe on any message replies; the
 * row's `--swipe-x`, `--swipe-progress` and `--swipe-scale` come out, written
 * straight to the custom properties rather than through a style binding, so the
 * contents translate on the compositor.
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

  createPointerListeners({
    target: row,
    pointerTypes: ["mouse", "touch", "pen"],
    onDown: (event) => gesture.down(event.clientX, event.clientY),
    onMove: (event) => {
      gesture.move(event.clientX, event.clientY)
      paint(gesture.offset)
    },
    onUp: () => gesture.release(),
    onCancel: () => gesture.cancel(),
  })

  /*
   * The trackpad path. It drives the SAME state machine as the pointer path, by
   * feeding it synthetic coordinates rather than by growing a second machine:
   * `direction * travel` is exactly the x the gesture already expects, so the
   * axis lock, the arming threshold, the snap-back and the commit stay in one
   * place. The sign is taken from the swipe itself, so either direction replies.
   *
   * The gesture ends when the wheel goes quiet, or when the deltas are seen to
   * decay into inertia, which is how we learn the fingers have lifted.
   */
  createEffect(() => {
    const element = row()
    if (!element) return

    let axis: "x" | "y" | undefined
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

    /** The live sign of the wheel swipe. Set once per gesture, on engage. */
    let wheelDirection: 1 | -1 = 1

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
        // Engage on any horizontal-dominant swipe. Vertical scrolling, the
        // browser's own back-swipe and inner horizontal scrollers are still left
        // alone, so the only gesture claimed is a deliberately sideways one.
        if (
          Math.abs(raw) <= Math.abs(event.deltaY) ||
          raw === 0 ||
          innerScrollsToward(event.target, element, raw)
        ) {
          axis = "y"
          scheduleIdle()
          return
        }
        axis = "x"
        wheelDirection = raw > 0 ? 1 : -1
        travel = 0
        prevAbs = -1
        peakAbs = 0
        decel = 0
        released = false
        gesturing = true
        gesture.down(0, 0)
      }

      if (axis === "y") {
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
      gesture.move(wheelDirection * travel, 0)
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
    get "data-swipe-side"() {
      return gesture.side
    },
  }

  return {
    swiping: () => gesture.swiping,
    offset: () => gesture.offset,
    progress: () => gesture.progress,
    scale: () => gesture.scale,
    indicatorSide: () => gesture.side,
    handlers,
  }
}
