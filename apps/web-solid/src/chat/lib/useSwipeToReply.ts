import { createPointerListeners } from "@solid-primitives/pointer"
import { animate } from "motion"
import { createSignal, onCleanup, type Accessor } from "solid-js"

/** Furthest the row contents travel, in px. */
export const SWIPE_MAX_TRAVEL_PX = 64
/** Travel at which the gesture arms the reply, released. */
export const SWIPE_REPLY_THRESHOLD_PX = 48
/** Vertical movement that loses the axis to the scroller before the lock closes. */
export const SWIPE_AXIS_LOCK_PX = 20
/** Horizontal movement that wins the axis before anything is drawn. */
export const SWIPE_INTENT_PX = 8

const INDICATOR_SCALE_MIN = 0.55

export type SwipeSide = "user" | "bot"

/**
 * The agent's row reveals its indicator on the left, so it is swiped right; the
 * viewer's reveals on the right, so it is swiped left. Swiping the other way is
 * a miss, not a gesture, and cancels.
 */
const SWIPE_DIRECTION: Record<SwipeSide, 1 | -1> = { bot: 1, user: -1 }

type Axis = "pending" | "horizontal" | "cancelled"

/** Drives one number back to zero and reports when it got there. */
export type SwipeSettle = (from: number, done: () => void) => void

export interface SwipeGestureOptions {
  side: () => SwipeSide
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
  const direction = () => SWIPE_DIRECTION[options.side()]

  let axis: Axis = "cancelled"
  let originX = 0
  let originY = 0
  let settling = false
  let armed = false

  const [swiping, setSwiping] = createSignal(false)
  const [offset, setOffset] = createSignal(0)
  const [progress, setProgress] = createSignal(0)
  const [scale, setScale] = createSignal(INDICATOR_SCALE_MIN)

  const paint = (travel: number) => {
    const ratio = Math.min(1, travel / SWIPE_REPLY_THRESHOLD_PX)
    setOffset(direction() * travel)
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
        if (dx * direction() <= 0) {
          axis = "cancelled"
          return
        }
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
  /** The row whose `--swipe-x` the gesture drives. */
  row: Accessor<HTMLElement | undefined>
  side: Accessor<SwipeSide>
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

/**
 * Wires the swipe gesture to a row: pointer and touch in, `--swipe-x`,
 * `--swipe-progress` and `--swipe-scale` on the row out. The travel is written
 * straight to the custom property rather than through a style binding, so the
 * row's contents translate on the compositor.
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

  const gesture = createSwipeGesture({ side: options.side, settle, onReply: options.onReply })

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

  onCleanup(clear)

  const handlers: SwipeRowHandlers = {
    ref: (element) => setRow(() => element),
    get "data-swiping"() {
      return gesture.swiping ? true : undefined
    },
    get "data-swipe-side"() {
      return options.side()
    },
  }

  return {
    swiping: () => gesture.swiping,
    offset: () => gesture.offset,
    progress: () => gesture.progress,
    scale: () => gesture.scale,
    indicatorSide: options.side,
    handlers,
  }
}
