import { KikoMark } from "../../lib/brand"
import { DETAIL, FIGURE, FIGURE_SIZE, FIGURE_VIEW, SHEET } from "./mural.gen"

/** The logo's bunny, in the card's head beside the wordmark. Now and then its leaves wiggle. */
export function Mascot() {
  return (
    <div class="welcome-mascot" aria-hidden="true">
      <div class="welcome-mascot-body">
        <KikoMark />
      </div>
    </div>
  )
}

/*
 * The page behind the card, a drawing sheet: a fine grid inside a margin, Kiko drawn as a construction
 * figure with its measures and callouts, a detail view of a leaf, and a title block. The drawings come
 * from the avatar (scripts/gen-mural.ts) and are inline SVG, so they are sharp at any pixel density, in
 * the theme's colors.
 */
export function Backdrop() {
  return (
    <div class="welcome-backdrop" aria-hidden="true">
      <svg class="welcome-sheet" innerHTML={SHEET} />
      <div class="welcome-margin" />
      <svg class="welcome-figure" viewBox={FIGURE_VIEW} width={FIGURE_SIZE[0]} height={FIGURE_SIZE[1]} innerHTML={FIGURE} />
      <svg class="welcome-detail" viewBox="-130 -125 260 250" width="260" height="250" innerHTML={DETAIL} />
      <svg class="welcome-title-block" viewBox="0 0 284 66" width="284" height="66" aria-hidden="true">
        <path d="M.5 .5H283.5V65.5H.5ZM.5 33.5H283.5M180.5 .5V65.5M232.5 33.5V65.5" />
        <text x="12" y="21">Kiko</text>
        <text x="192" y="21">Fig. 1</text>
        <text x="12" y="54">Front, three quarter</text>
        <text x="192" y="54">3:1</text>
        <text x="244" y="54">A1</text>
      </svg>
    </div>
  )
}
