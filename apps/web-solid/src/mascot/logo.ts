import { birdSvg, VIEWBOX, YUKI_BIRD } from "./birds"

/**
 * Yuki as a standalone SVG document, for places the app's CSS cannot reach: the favicon and the
 * boot screen. The loaf, Yuki's mark, in a square box. `flat` draws a straight ink line, which
 * stays crisp at 16 px.
 */
export function logoSvg(flat = false): string {
  const [x, y, w, h] = VIEWBOX.loaf
  const pad = (w - h) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y - pad} ${w} ${w}">${birdSvg(YUKI_BIRD, "idle", { shape: "loaf", flat, size: flat ? 16 : 64 })}</svg>`
}
