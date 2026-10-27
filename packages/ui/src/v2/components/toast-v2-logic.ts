export type ToastV2Variant = "default" | "success" | "error" | "warning" | "info" | "loading"

const TOAST_DURATION_MS = 5000
const ACTIONABLE_ERROR_MS = 12000
const ANCHORED_TOAST_DURATION_MS = 1000
const TOAST_LIMIT = 3
const SWIPE_THRESHOLD_PX = 40
export const ERROR_CLAMP_CHARS = 180

export function toastDuration(options: {
  variant?: ToastV2Variant
  duration?: number
  persistent?: boolean
  anchored?: boolean
  actionable?: boolean
}): number {
  if (options.persistent) return Number.POSITIVE_INFINITY
  if (options.duration !== undefined) return options.duration > 0 ? options.duration : Number.POSITIVE_INFINITY
  if (options.variant === "loading") return Number.POSITIVE_INFINITY
  if (options.actionable && options.variant === "error") return ACTIONABLE_ERROR_MS
  return options.anchored ? ANCHORED_TOAST_DURATION_MS : TOAST_DURATION_MS
}

export type ToastPlacement = { kind: "add" } | { kind: "refresh"; id: number } | { kind: "replace"; id: number }

export function placeToast(live: readonly { id: number; key: string }[], key: string): ToastPlacement {
  const index = live.findIndex((toast) => toast.key === key)
  if (index === -1) return { kind: "add" }
  return index === 0 ? { kind: "refresh", id: live[0]!.id } : { kind: "replace", id: live[index]!.id }
}

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

export type SwipeOutcome = "out-x" | "out-y" | null

export function swipeOutcome(axis: "x" | "y" | null, dx: number, dy: number, outward: 1 | -1): SwipeOutcome {
  if (axis === "x") return dx * outward >= SWIPE_THRESHOLD_PX ? "out-x" : null
  if (axis === "y") return -dy >= SWIPE_THRESHOLD_PX ? "out-y" : null
  return null
}

export function swipeDamp(delta: number, allowed: boolean): number {
  if (allowed) return delta
  return delta / (1.5 + Math.abs(delta) / 20)
}
