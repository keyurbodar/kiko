import type { ValueAnimationTransition } from "motion"

/*
 * `motion` is about 18 KB gzip and nothing on first paint animates, so it stays out of tier 2.
 * `preload()` in main.tsx fetches it on idle. A call that comes before it lands starts the
 * animation as soon as the module arrives, and `stop()` still cancels it.
 */
type Motion = typeof import("motion")

let motion: Motion | undefined
let loading: Promise<Motion> | undefined

export function loadMotion(): Promise<Motion> {
  return (loading ??= import("motion").then((module) => (motion = module)))
}

export interface AnimationControls {
  stop(): void
}

/* Animates a number, like `animate(from, to, options)` from `motion`. */
export function animate(from: number, to: number, options: ValueAnimationTransition<number>): AnimationControls {
  if (motion) return motion.animate(from, to, options)
  let stopped = false
  let inner: AnimationControls | undefined
  void loadMotion().then((module) => {
    if (!stopped) inner = module.animate(from, to, options)
  })
  return {
    stop() {
      stopped = true
      inner?.stop()
    },
  }
}
