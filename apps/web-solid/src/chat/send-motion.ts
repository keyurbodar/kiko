const LAUNCH_WINDOW_MS = 1500
const DURATION_MS = 320
const EASING = "cubic-bezier(.2,.8,.2,1)"

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches

export type Launch = { top: number; at: number }

export const captureLaunch = (dock: HTMLElement | undefined): Launch | null =>
  dock ? { top: dock.getBoundingClientRect().top, at: performance.now() } : null

export function glideToDock(dock: HTMLElement, from: Launch | null): void {
  if (!from || reducedMotion() || typeof dock.animate !== "function") return
  if (performance.now() - from.at > LAUNCH_WINDOW_MS) return
  const dy = from.top - dock.getBoundingClientRect().top
  if (Math.abs(dy) < 1) return
  dock.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], {
    duration: DURATION_MS,
    easing: EASING,
  })
}
