import { describe, expect, test } from "bun:test"
import {
  ANCHORED_TOAST_DURATION_MS,
  TOAST_DURATION_MS,
  placeToast,
  stackLayout,
  swipeDamp,
  swipeOutcome,
  toastDuration,
} from "./toast-v2-logic"

describe("toastDuration", () => {
  test("every variant waits five seconds, as Base UI and t3code do", () => {
    for (const variant of ["default", "success", "error", "warning", "info"] as const)
      expect(toastDuration({ variant })).toBe(TOAST_DURATION_MS)
  })

  test("a loading toast stays until its result replaces it", () => {
    expect(toastDuration({ variant: "loading" })).toBe(Number.POSITIVE_INFINITY)
  })

  test("an anchored toast is a one second confirmation", () => {
    expect(toastDuration({ anchored: true })).toBe(ANCHORED_TOAST_DURATION_MS)
  })

  test("an explicit duration wins, and zero or persistent means it stays", () => {
    expect(toastDuration({ variant: "loading", duration: 2000 })).toBe(2000)
    expect(toastDuration({ duration: 0 })).toBe(Number.POSITIVE_INFINITY)
    expect(toastDuration({ duration: 2000, persistent: true })).toBe(Number.POSITIVE_INFINITY)
  })
})

describe("placeToast", () => {
  const live = [
    { id: 3, key: "c" },
    { id: 2, key: "b" },
    { id: 1, key: "a" },
  ]

  test("a new toast is added", () => {
    expect(placeToast(live, "d")).toEqual({ kind: "add" })
  })

  test("the same toast as the front one refreshes it in place", () => {
    expect(placeToast(live, "c")).toEqual({ kind: "refresh", id: 3 })
  })

  test("the same toast as an older one replaces it at the front", () => {
    expect(placeToast(live, "a")).toEqual({ kind: "replace", id: 1 })
  })
})

describe("stackLayout", () => {
  test("offsets add up the heights in front, newest first", () => {
    const { frontHeight, slots } = stackLayout([
      { id: 3, height: 50, ending: false },
      { id: 2, height: 70, ending: false },
      { id: 1, height: 40, ending: false },
    ])
    expect(frontHeight).toBe(50)
    expect(slots.get(3)).toEqual({ index: 0, offset: 0, limited: false })
    expect(slots.get(2)).toEqual({ index: 1, offset: 50, limited: false })
    expect(slots.get(1)).toEqual({ index: 2, offset: 120, limited: false })
  })

  test("a closing toast keeps its slot while the live ones move up past it", () => {
    const { frontHeight, slots } = stackLayout([
      { id: 3, height: 50, ending: true },
      { id: 2, height: 70, ending: false },
    ])
    expect(frontHeight).toBe(70)
    expect(slots.get(3)).toEqual({ index: 0, offset: 0, limited: false })
    expect(slots.get(2)).toEqual({ index: 0, offset: 0, limited: false })
  })

  test("toasts past the limit of three are hidden until one in front closes", () => {
    const toasts = [4, 3, 2, 1].map((id) => ({ id, height: 40, ending: false }))
    expect(stackLayout(toasts).slots.get(1)?.limited).toBe(true)
    expect(stackLayout(toasts.map((t) => (t.id === 4 ? { ...t, ending: true } : t))).slots.get(1)?.limited).toBe(false)
  })
})

describe("swipe", () => {
  test("a swipe toward the toaster's edge or upward past the threshold dismisses", () => {
    expect(swipeOutcome("x", 41, 0, 1)).toBe("out-x")
    expect(swipeOutcome("x", -41, 0, -1)).toBe("out-x")
    expect(swipeOutcome("y", 0, -41, 1)).toBe("out-y")
  })

  test("a short swipe, or one the wrong way, springs back", () => {
    expect(swipeOutcome("x", 20, 0, 1)).toBeNull()
    expect(swipeOutcome("x", -80, 0, 1)).toBeNull()
    expect(swipeOutcome("y", 0, 80, 1)).toBeNull()
    expect(swipeOutcome(null, 80, 80, 1)).toBeNull()
  })

  test("movement the wrong way is damped", () => {
    expect(swipeDamp(30, true)).toBe(30)
    expect(Math.abs(swipeDamp(-30, false))).toBeLessThan(15)
  })
})
