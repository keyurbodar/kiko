import { Show } from "solid-js"

/** The favicon's mascot (scripts/gen-brand.ts writes both faces). It breathes, and blinks by showing the closed-eye face over the eyes alone. */
export function Mascot() {
  return (
    <div class="welcome-mascot" aria-hidden="true">
      <div class="welcome-mascot-body">
        <img src="/kiko-mascot.svg" alt="" draggable={false} />
        <img src="/kiko-mascot-blink.svg" alt="" draggable={false} class="welcome-mascot-blink" />
      </div>
    </div>
  )
}

const plus = (x: number, y: number) => `M${x - 6} ${y}h12M${x} ${y - 6}v12`

/*
 * The favicon's blueprint, grown to the screen: a drifting grid, dashed orbits turning around the mascot,
 * crosshair lines with a scan running along them, corner marks, and the accent's glow. Every layer moves
 * by transform or opacity only, takes its colors from the theme, and holds still under reduced motion.
 * While something is working, rings pulse out from the mascot.
 */
export function Backdrop(props: { busy: boolean }) {
  return (
    <div class="welcome-backdrop" aria-hidden="true">
      <div class="welcome-grid">
        <div class="welcome-grid-pan" />
      </div>
      <div class="welcome-cross-x" />
      <div class="welcome-cross-y" />
      <div class="welcome-stage">
        <div class="welcome-glow" />
        <svg class="welcome-orbit welcome-orbit-near" viewBox="-100 -100 200 200">
          <circle r="96" />
        </svg>
        <svg class="welcome-orbit welcome-orbit-far" viewBox="-180 -180 360 360">
          <circle r="176" />
          <circle class="welcome-satellite" cx="0" cy="-176" r="3" />
        </svg>
        <svg class="welcome-orbit welcome-orbit-edge" viewBox="-280 -280 560 560">
          <circle r="276" />
          <circle class="welcome-satellite" cx="0" cy="276" r="2" />
        </svg>
        <svg class="welcome-ticks" viewBox="-160 -160 320 320">
          <path d={[plus(-124, -124), plus(124, -124), plus(-124, 124), plus(124, 124)].join("")} />
        </svg>
        <Show when={props.busy}>
          <i class="welcome-pulse" />
          <i class="welcome-pulse" style={{ "animation-delay": "1.2s" }} />
        </Show>
      </div>
    </div>
  )
}
