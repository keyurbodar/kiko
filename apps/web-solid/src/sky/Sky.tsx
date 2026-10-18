/*
 * The sky behind onboarding and the sidebar's top band. Two scenes, one component, so the band a
 * person sees in the sidebar is literally the top of the scene they just came through.
 *
 * Every layer is a static div with a CSS background. No canvas, no SVG filter, no image, no JS: the
 * band has to paint in the first frame, before the warm tier answers, and the scene has to survive
 * the snapshot with no animation running inside it.
 */

import "./sky.css"

export type SkyKind = "moonlit" | "bokeh"

export interface SkyProps {
  kind: SkyKind
  /**
   * `band` is the sidebar's crop: the same scene, seen through a 116px window, with the moon pulled
   * into the top-right corner. `scene` is the full-window onboarding backdrop.
   */
  size?: "band" | "scene"
}

export function Sky(props: SkyProps) {
  return (
    <div class="sky" data-sky={props.kind} data-sky-size={props.size ?? "scene"} aria-hidden="true">
      <div class="sky-glow" />
      <div class="sky-stars" />
      <div class="sky-beam" />
      <div class="sky-bokeh" />
      <div class="sky-grain" />
    </div>
  )
}
