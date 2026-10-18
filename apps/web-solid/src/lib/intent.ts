import { makeEventListener } from "@solid-primitives/event-listener"
import { debounce } from "@solid-primitives/scheduled"
import { onCleanup } from "solid-js"

/*
 * Intent preloading. "Intent" is the pointer resting on an
 * element for 80 ms, a pointer down, or keyboard focus. The callback is how
 * the caller warms what the element opens: a route chunk or a chat's messages.
 *
 * Moving across a list without stopping never reaches 80 ms on any one row, so
 * nothing loads. Leaving cancels the timer. Nothing fires while the tab is
 * hidden or the connection asks to save data.
 */
export const HOVER_MS = 80

export type IntentOptions = {
  /** Hover delay. Defaults to 80 ms. */
  delayMs?: number
  /** False blocks every trigger. Defaults to a visible tab without `saveData`. */
  allowed?: () => boolean
  /** The cancellable timer. Defaults to `debounce`, which is a no-op in the server build that `bun test` loads. */
  timer?: typeof debounce
}

export function intentAllowed(): boolean {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return false
  const connection = (globalThis.navigator as { connection?: { saveData?: boolean } } | undefined)?.connection
  return connection?.saveData !== true
}

/** Wires intent events on `el`. Call inside a reactive owner, so the listeners and timer are cleaned up. */
export function createIntent(el: EventTarget, onIntent: () => void, options: IntentOptions = {}): void {
  const allowed = options.allowed ?? intentAllowed
  const fire = () => {
    if (allowed()) onIntent()
  }
  const hover = (options.timer ?? debounce)(fire, options.delayMs ?? HOVER_MS)
  makeEventListener(el, "pointerenter", () => hover())
  makeEventListener(el, "pointerleave", () => hover.clear())
  makeEventListener(el, "pointercancel", () => hover.clear())
  makeEventListener(el, "pointerdown", () => {
    hover.clear()
    fire()
  })
  makeEventListener(el, "focusin", fire)
  onCleanup(hover.clear)
}

/** A `ref` callback for JSX: `<a ref={intentRef(() => preloadRoute(href))}>`. */
export function intentRef(onIntent: () => void, options?: IntentOptions) {
  return (el: HTMLElement) => createIntent(el, onIntent, options)
}
