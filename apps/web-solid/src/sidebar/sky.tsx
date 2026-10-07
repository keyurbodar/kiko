import { For, type JSX } from "solid-js"
import "./sky.css"

/*
 * The top of the sidebar: kiko's sky, painted behind the brand row in the space it already takes.
 * Minimal, with no card and no edge: a faint glow of the theme's accent from the corner, a soft aurora,
 * a few stars and one four-point sparkle, a low haze of cloud, and far off, a small flock
 * crossing it. It fades into the sidebar before the chat list starts. t3code paints artwork
 * behind its brand; the flock is kiko's touch, birds the way they look from the ground.
 *
 * Decoration only: it never takes a pointer and nothing in it moves on navigation. The stars
 * twinkle slowly and the flock drifts a few pixels; both stop for reduced motion.
 */

/** Stars as [x %, y px, radius, twinkle delay s], kept clear of the brand on the left. */
const STARS: readonly [number, number, number, number][] = [
  [38, 9, 0.45, 0],
  [49, 28, 0.35, 1.4],
  [57, 6, 0.4, 2.6],
  [70, 18, 0.35, 0.8],
]

/** The flock: [x, y, scale] in its own 100 x 30 box, a loose V heading left. */
const FLOCK: readonly [number, number, number][] = [
  [10, 16, 1],
  [26, 9, 0.85],
  [28, 23, 0.8],
  [44, 4, 0.7],
  [47, 27, 0.66],
]

/** One bird as two wing strokes, seen from below. */
const WING = "M-7 2.4 Q-3.5 -3.2 0 0.8 Q3.5 -3.2 7 2.4"

/** A four-point sparkle. */
const SPARKLE = "M0 -4 Q0.6 -0.6 4 0 Q0.6 0.6 0 4 Q-0.6 0.6 -4 0 Q-0.6 -0.6 0 -4 Z"

export function SidebarSky(): JSX.Element {
  return (
    <div class="sidebar-sky" data-component="sidebar-sky" aria-hidden="true">
      <div class="sidebar-sky-aurora" />
      <svg class="sidebar-sky-stars" viewBox="0 0 100 44" preserveAspectRatio="none">
        <For each={STARS}>{([x, y, r, d]) => <circle cx={x} cy={y} r={r} style={{ "animation-delay": `${d}s` }} />}</For>
      </svg>
      <svg class="sidebar-sky-sparkle" style={{ left: "62%", top: "11px" }} viewBox="-5 -5 10 10">
        <path d={SPARKLE} />
      </svg>
      <svg class="sidebar-sky-flock" viewBox="0 0 100 30">
        <For each={FLOCK}>{([x, y, s]) => <path d={WING} transform={`translate(${x} ${y}) scale(${s})`} />}</For>
      </svg>
      <div class="sidebar-sky-haze" />
    </div>
  )
}
