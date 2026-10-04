import { createSignal } from "solid-js"

/*
 * Holding the command key shows every on-screen control's shortcut, as kat does. A control opts in
 * with `data-hint="<command id>"` (and `data-hint-side`, "bottom" by default); the layer reads the
 * label and key from the registry, so a hint never disagrees with the real shortcut.
 *
 * The hold is a pure decision over key events, kept here so it tests without a DOM.
 */

/** How long the modifier must be held alone before the hints show. */
export const HOLD_MS = 450

export type HoldEvent = { type: "down" | "up"; key: string; repeat?: boolean } | { type: "blur" }

export type HoldState = "idle" | "holding" | "shown"

/** The next state after one event. `holding` starts the timer; the timer moves it to `shown`. */
export function nextHold(state: HoldState, event: HoldEvent): HoldState {
  if (event.type === "blur") return "idle"
  const modifier = event.key === "Meta" || event.key === "Control"
  if (event.type === "up") return "idle"
  if (!modifier) return "idle" // a shortcut is being typed, not looked for
  if (event.repeat) return state
  return state === "idle" ? "holding" : state
}

const [shown, setShown] = createSignal(false)
/** True while the hints are on screen. */
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

/** Listens for the hold. Call once in the shell; returns the cleanup. */
export function watchHold(): () => void {
  const down = (e: KeyboardEvent) => apply({ type: "down", key: e.key, repeat: e.repeat })
  const up = (e: KeyboardEvent) => apply({ type: "up", key: e.key })
  const blur = () => apply({ type: "blur" })
  const hidden = () => document.hidden && blur()
  window.addEventListener("keydown", down, true)
  window.addEventListener("keyup", up, true)
  window.addEventListener("blur", blur)
  // A click while holding is a shortcut-free click, and the hints should not linger over it.
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
