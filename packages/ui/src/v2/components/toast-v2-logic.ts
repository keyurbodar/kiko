/*
 * The toaster's rules as data, after t3code (MIT, apps/web/src/components/ui/toast.logic.ts,
 * anchoredCopyToast.ts) and Base UI's toast defaults. No DOM here, so the tests can run it.
 */

export type ToastV2Variant = "default" | "success" | "error" | "warning" | "info" | "loading"

/* Base UI's default timeout, which t3code keeps for every type. A loading toast waits for its result. */
export const TOAST_DURATION_MS = 5000
/* t3code's copy confirmation next to the button that copied. */
export const ANCHORED_TOAST_DURATION_MS = 1000
/* Base UI's default limit: older toasts wait, hidden, until one in front closes. */
export const TOAST_LIMIT = 3
/* How far a toast travels before a release dismisses it. */
export const SWIPE_THRESHOLD_PX = 40
/* An error description this long is clamped to four lines, as t3code does. */
export const ERROR_CLAMP_CHARS = 180

export function toastDuration(options: {
  variant?: ToastV2Variant
  duration?: number
  persistent?: boolean
  anchored?: boolean
}): number {
  if (options.persistent) return Number.POSITIVE_INFINITY
  if (options.duration !== undefined) return options.duration > 0 ? options.duration : Number.POSITIVE_INFINITY
  if (options.variant === "loading") return Number.POSITIVE_INFINITY
  return options.anchored ? ANCHORED_TOAST_DURATION_MS : TOAST_DURATION_MS
}

/*
 * Where a new toast goes, given the live toasts newest first. The same toast again refreshes
 * the front one in place, or moves an older copy to the front, so a repeated action never
 * stacks copies.
 */
export type ToastPlacement = { kind: "add" } | { kind: "refresh"; id: number } | { kind: "replace"; id: number }

export function placeToast(live: readonly { id: number; key: string }[], key: string): ToastPlacement {
  const index = live.findIndex((toast) => toast.key === key)
  if (index === -1) return { kind: "add" }
  return index === 0 ? { kind: "refresh", id: live[0]!.id } : { kind: "replace", id: live[index]!.id }
}

/*
 * Each toast's place in the stack, newest first. A closing toast keeps the slot it had so it
 * leaves from where it was, while the live ones behind it move up at once. A toast past the
 * limit is kept but hidden.
 */
export interface ToastSlot {
  index: number
  offset: number
  limited: boolean
}

export function stackLayout(toasts: readonly { id: number; height: number; ending: boolean }[]): {
  frontHeight: number
  slots: Map<number, ToastSlot>
} {
  const slots = new Map<number, ToastSlot>()
  let fullIndex = 0
  let fullOffset = 0
  let liveIndex = 0
  let liveOffset = 0
  for (const toast of toasts) {
    const height = toast.height > 0 && Number.isFinite(toast.height) ? toast.height : 0
    if (toast.ending) {
      slots.set(toast.id, { index: fullIndex, offset: fullOffset, limited: fullIndex >= TOAST_LIMIT })
    } else {
      slots.set(toast.id, { index: liveIndex, offset: liveOffset, limited: liveIndex >= TOAST_LIMIT })
      liveIndex += 1
      liveOffset += height
    }
    fullIndex += 1
    fullOffset += height
  }
  const front = toasts.find((toast) => !toast.ending)
  return { frontHeight: front && front.height > 0 ? front.height : 0, slots }
}

/*
 * What a released swipe does. A toast leaves toward its own edge or upward, past the threshold.
 * `outward` is 1 when the toaster sits on the right, -1 on the left.
 */
export type SwipeOutcome = "out-x" | "out-y" | null

export function swipeOutcome(axis: "x" | "y" | null, dx: number, dy: number, outward: 1 | -1): SwipeOutcome {
  if (axis === "x") return dx * outward >= SWIPE_THRESHOLD_PX ? "out-x" : null
  if (axis === "y") return -dy >= SWIPE_THRESHOLD_PX ? "out-y" : null
  return null
}

/* Movement against an allowed direction is damped, so the toast resists instead of following. */
export function swipeDamp(delta: number, allowed: boolean): number {
  if (allowed) return delta
  return delta / (1.5 + Math.abs(delta) / 20)
}
