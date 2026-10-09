// The composer's glide on a chat's first send, after monocode's `useComposerDockMotion` (MIT,
// src/features/sessions/ui/useComposerDockMotion.ts). An empty chat holds the composer in the
// middle of the pane; the first send docks it at the bottom. Instead of jumping there, it slides
// straight down from where it was. It is a web animation, not a CSS class, because it has to
// measure where the composer started.

/** A send only counts as the launch if the composer docks shortly after it. */
const LAUNCH_WINDOW_MS = 1500
const DURATION_MS = 480
const EASING = "cubic-bezier(0.22, 1, 0.36, 1)"

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches

export type Launch = { top: number; at: number }

/** Where the composer is now, taken the moment a first message is sent. */
export const captureLaunch = (dock: HTMLElement | undefined): Launch | null => (dock ? { top: dock.getBoundingClientRect().top, at: performance.now() } : null)

/** Slides the docked composer down from where the launch left it. */
export function glideToDock(dock: HTMLElement, from: Launch | null): void {
  if (!from || reducedMotion() || typeof dock.animate !== "function") return
  if (performance.now() - from.at > LAUNCH_WINDOW_MS) return
  const dy = from.top - dock.getBoundingClientRect().top
  if (Math.abs(dy) < 1) return
  dock.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], { duration: DURATION_MS, easing: EASING })
}
