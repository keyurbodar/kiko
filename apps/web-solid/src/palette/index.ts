import { lazy } from "solid-js"

/*
 * Tier 3. The panel loads on the first modifier key press, so by the time a
 * chord completes it is already parsed and the open takes one frame.
 */
const load = () => import("./palette")
export const Palette = lazy(load)

let preloaded = false
export function preloadPalette(): void {
  if (preloaded) return
  preloaded = true
  void load()
}
