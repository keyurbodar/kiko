import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"

const SMOOTH_WINDOW_MS = 450
const WORD_BACKLOG = 40
const MAX_FRAME_MS = 100
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)"

export type SmoothStep = { shown: string; elapsed: number }

function wordCut(target: string, at: number): number {
  if (at >= target.length) return target.length
  const space = target.slice(at).search(/\s/)
  return space === -1 ? target.length : at + space + 1
}

function advance(shown: string, target: string, count: number): string {
  const backlog = target.length - shown.length
  const desired = Math.min(target.length, shown.length + count)
  const cut = backlog > WORD_BACKLOG ? wordCut(target, desired) : desired
  const code = target.charCodeAt(cut - 1)
  return target.slice(0, code >= 0xd800 && code <= 0xdbff && cut < target.length ? cut + 1 : cut)
}

export function smoothStep(input: { shown: string; target: string; elapsed: number; dt: number }): SmoothStep {
  const { shown, target, elapsed, dt } = input
  if (shown === target) return { shown: target, elapsed: SMOOTH_WINDOW_MS }
  if (!target.startsWith(shown)) return { shown: target, elapsed: SMOOTH_WINDOW_MS }
  const backlog = target.length - shown.length
  const remaining = Math.max(1, SMOOTH_WINDOW_MS - elapsed)
  const count = Math.max(1, Math.ceil((backlog * Math.max(0, dt)) / remaining))
  return { shown: advance(shown, target, count), elapsed: elapsed + Math.max(0, dt) }
}

export function useSmoothText(target: () => string, live: () => boolean): Accessor<string> {
  const [shown, setShown] = createSignal(target())
  let frame: number | undefined
  let elapsed = SMOOTH_WINDOW_MS
  let last = 0

  const reduced = () => typeof window !== "undefined" && window.matchMedia(REDUCED_MOTION).matches
  const stop = () => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
    frame = undefined
  }
  const flush = () => {
    stop()
    setShown(target())
    elapsed = SMOOTH_WINDOW_MS
  }
  function tick(now: number) {
    frame = undefined
    if (reduced() || !live()) {
      flush()
      return
    }
    const dt = last === 0 ? 16 : Math.min(now - last, MAX_FRAME_MS)
    last = now
    const step = smoothStep({ shown: shown(), target: target(), elapsed, dt })
    elapsed = step.elapsed
    setShown(step.shown)
    if (step.shown !== target()) frame = requestAnimationFrame(tick)
  }
  function start() {
    if (frame !== undefined) return
    last = 0
    frame = requestAnimationFrame(tick)
  }
  createEffect(
    on(
      target,
      (next) => {
        if (reduced() || !live() || !next.startsWith(shown())) {
          flush()
          return
        }
        elapsed = 0
        start()
      },
      { defer: true },
    ),
  )
  createEffect(
    on(
      live,
      (isLive) => {
        if (!isLive) flush()
      },
      { defer: true },
    ),
  )
  onCleanup(stop)
  return shown
}
