import { For, Show, type JSX } from "solid-js"
import { daypartOf } from "../mascot/scene"
import "./sky.css"

/*
 * The top of the sidebar: Yuki's sky, painted behind the brand row in the space it already takes.
 * Minimal, with no card and no edge: a faint glow of the theme's accent from the corner, a soft
 * aurora, a low haze of cloud, and far off, two Shima Enaga crossing it in their bouncing flight,
 * round bodies trailing long tails. Morning and evening warm the glow; at night come a few
 * stars, a sparkle and a thin moon. It fades into the sidebar before the chat list starts.
 *
 * Decoration only: it never takes a pointer and nothing in it moves on navigation. The stars
 * twinkle slowly and the birds bob a few pixels; both stop for reduced motion.
 */

/** Stars as [x %, y px, radius, twinkle delay s], kept clear of the brand on the left. */
const STARS: readonly [number, number, number, number][] = [
  [38, 9, 0.45, 0],
  [49, 28, 0.35, 1.4],
  [57, 6, 0.4, 2.6],
  [70, 18, 0.35, 0.8],
]

/** Two far-off birds: [x, y, scale] in their own 100 x 30 box, heading left. */
const FLOCK: readonly [number, number, number][] = [
  [14, 14, 1],
  [40, 8, 0.8],
]

/** A Shima Enaga in flight, from far off: a round body, a wing nub and a long thin tail. */
const ENAGA = "M-4 0 A4 4 0 1 1 4 0 A4 4 0 1 1 -4 0Z M3 -0.6 L15 -2.4 L15.2 -1 L3.4 1.2Z"
const WING = "M-1 -2.6 Q1.6 -7 4.4 -5.4 Q3 -2.6 1 -0.4Z"

/** A four-point sparkle. */
const SPARKLE = "M0 -4 Q0.6 -0.6 4 0 Q0.6 0.6 0 4 Q-0.6 0.6 -4 0 Q-0.6 -0.6 0 -4 Z"

/** A thin crescent moon. */
const MOON = "M4 -6 C0 -6 -3 -2.6 -3 1 C-3 4.6 0 7.4 4 7.6 C1.2 6 0 3.6 0 1 C0 -2 1.6 -4.6 4 -6Z"

export function SidebarSky(props: { now?: Date }): JSX.Element {
  const daypart = daypartOf(props.now ?? new Date())
  return (
    <div class="sidebar-sky" data-component="sidebar-sky" data-daypart={daypart} aria-hidden="true">
      <div class="sidebar-sky-aurora" />
      <Show when={daypart === "night"}>
        <svg class="sidebar-sky-stars" viewBox="0 0 100 44" preserveAspectRatio="none">
          <For each={STARS}>{([x, y, r, d]) => <circle cx={x} cy={y} r={r} style={{ "animation-delay": `${d}s` }} />}</For>
        </svg>
        <svg class="sidebar-sky-sparkle" style={{ left: "62%", top: "11px" }} viewBox="-5 -5 10 10">
          <path d={SPARKLE} />
        </svg>
        <svg class="sidebar-sky-moon" viewBox="-5 -8 10 16">
          <path d={MOON} />
        </svg>
      </Show>
      <svg class="sidebar-sky-flock" viewBox="0 0 100 30">
        <For each={FLOCK}>
          {([x, y, s], i) => (
            <g transform={`translate(${x} ${y}) scale(${s})`}>
              <g class="sidebar-sky-bird" style={{ "animation-delay": `${i() * -0.7}s` }}>
                <path d={ENAGA} />
                <path class="sidebar-sky-wing" d={WING} />
              </g>
            </g>
          )}
        </For>
      </svg>
      <div class="sidebar-sky-haze" />
    </div>
  )
}
