import { createSignal } from "solid-js"

export const HOLD_MS = 450

export type HoldEvent = { type: "down" | "up"; key: string; repeat?: boolean } | { type: "blur" }

export type HoldState = "idle" | "holding" | "shown"

export function nextHold(state: HoldState, event: HoldEvent): HoldState {
  if (event.type === "blur") return "idle"
  const modifier = event.key === "Meta" || event.key === "Control"
  if (event.type === "up") return "idle"
  if (!modifier) return "idle"
  if (event.repeat) return state
  return state === "idle" ? "holding" : state
}

const [shown, setShown] = createSignal(false)
export const hintsShown = shown

let state: HoldState = "idle"
let timer: ReturnType<typeof setTimeout> | undefined

function apply(event: HoldEvent): void {
  const next = nextHold(state, event)
  if (next === state) return
  state = next
  clearTimeout(timer)
  if (next === "holding") {
    timer = setTimeout(() => {
      state = "shown"
      setShown(true)
    }, HOLD_MS)
  }
  if (next === "idle") setShown(false)
}

export function watchHold(): () => void {
  const down = (e: KeyboardEvent) => apply({ type: "down", key: e.key, repeat: e.repeat })
  const up = (e: KeyboardEvent) => apply({ type: "up", key: e.key })
  const blur = () => apply({ type: "blur" })
  const hidden = () => document.hidden && blur()
  window.addEventListener("keydown", down, true)
  window.addEventListener("keyup", up, true)
  window.addEventListener("blur", blur)
  window.addEventListener("pointerdown", blur, true)
  document.addEventListener("visibilitychange", hidden)
  return () => {
    clearTimeout(timer)
    window.removeEventListener("keydown", down, true)
    window.removeEventListener("keyup", up, true)
    window.removeEventListener("blur", blur)
    window.removeEventListener("pointerdown", blur, true)
    document.removeEventListener("visibilitychange", hidden)
  }
}
