import { makeEventListener } from "@solid-primitives/event-listener"
import { debounce } from "@solid-primitives/scheduled"
import { onCleanup } from "solid-js"

export const HOVER_MS = 80

export type IntentOptions = {
  delayMs?: number
  allowed?: () => boolean
  timer?: typeof debounce
}

export function intentAllowed(): boolean {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return false
  const connection = (globalThis.navigator as { connection?: { saveData?: boolean } } | undefined)?.connection
  return connection?.saveData !== true
}

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

export function intentRef(onIntent: () => void, options?: IntentOptions) {
  return (el: HTMLElement) => createIntent(el, onIntent, options)
}
