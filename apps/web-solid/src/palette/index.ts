import { lazy } from "solid-js"

const load = () => import("./palette")
export const Palette = lazy(load)

let preloaded = false
export function preloadPalette(): void {
  if (preloaded) return
  preloaded = true
  void load()
}
