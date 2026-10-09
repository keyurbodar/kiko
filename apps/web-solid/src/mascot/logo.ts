import { BIRD_VIEWBOX, birdSvg, YUKI } from "./birds"

/**
 * Yuki as a standalone SVG document, for places the app's CSS cannot reach: the favicon and the
 * boot screen. `flat` drops the shading, so the favicon stays crisp at 16 px.
 */
export function logoSvg(flat = false): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BIRD_VIEWBOX}">${birdSvg(YUKI, "idle", { flat })}</svg>`
}
