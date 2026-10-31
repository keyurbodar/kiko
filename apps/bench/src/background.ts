import type { Background, BackgroundCounter } from "./types"

export const BACKGROUND_COUNTERS: readonly BackgroundCounter[] = [
  "focusSteals",
  "pointerMoves",
  "keysSwallowed",
  "windowsRaised",
]

export const ZERO_BACKGROUND: Background = {
  focusSteals: 0,
  pointerMoves: 0,
  keysSwallowed: 0,
  windowsRaised: 0,
}

export function unmeasured(background: Background): ReadonlySet<BackgroundCounter> {
  return new Set(background.unmeasured ?? [])
}

export function backgroundSafe(background: Background): boolean {
  const unmeasuredCounters = unmeasured(background)
  return BACKGROUND_COUNTERS.every((counter) => !unmeasuredCounters.has(counter) && background[counter] === 0)
}

export type CounterCell = number | "unmeasured"

export function counterCell(background: Background, counter: BackgroundCounter): CounterCell {
  return unmeasured(background).has(counter) ? "unmeasured" : background[counter]
}
