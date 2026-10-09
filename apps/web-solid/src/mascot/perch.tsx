import { KIKO } from "@kiko/protocol"
import { For, Show } from "solid-js"
import { Bird } from "./bird"
import { birdFor } from "./choices"
import { daypartOf, SEASON_OUTFIT, seasonOf, type Season } from "./scene"
import "./perch.css"

/*
 * The empty chat: the chat's own birds huddled on a white birch twig, the way Shima Enaga
 * fledglings line up like dango. They breathe, blink and now and then tilt their heads. The
 * season drifts past (snow, petals, a maple leaf) and the night brings a moon. All of it is
 * CSS, so nothing runs a loop, and reduced motion leaves a still picture.
 */

/** Where each bird sits: its offset from the middle in px, its size, and whether it is in front. */
const HUDDLE: Record<number, readonly { dx: number; size: number; front?: boolean }[]> = {
  1: [{ dx: 0, size: 100 }],
  2: [{ dx: -26, size: 84 }, { dx: 26, size: 84 }],
  3: [{ dx: 0, size: 88, front: true }, { dx: -46, size: 74 }, { dx: 46, size: 74 }],
}

/** The twig's top edge in the 150 px scene. A bird's feet sit at 88 percent of its box. */
const BRANCH_Y = 118
const FEET = 0.88

const PARTICLE: Record<Season, string | null> = { winter: "snow", spring: "petal", summer: null, autumn: "leaf" }

export default function Perch(props: { faces: readonly string[]; now?: Date }) {
  const now = () => props.now ?? new Date()
  const faces = () => (props.faces.length ? props.faces : [KIKO]).slice(0, 3)
  const season = () => seasonOf(now())
  const night = () => daypartOf(now()) === "night"
  const spec = (slug: string) => {
    const b = birdFor(slug)
    return slug === KIKO && b.outfit === "none" ? { ...b, outfit: SEASON_OUTFIT[season()] } : b
  }
  const particle = () => PARTICLE[season()]

  return (
    <div class="perch" data-component="perch" data-season={season()} data-night={night() ? "" : undefined} aria-hidden="true">
      <svg class="perch-sky" viewBox="0 0 420 150" preserveAspectRatio="none">
        <Show when={night()}>
          <path class="perch-moon" d="M356 18 C348 18 342 25 342 33 C342 41 348 47 356 48 C350 45 347 40 347 33 C347 26 351 21 356 18Z" />
          <g class="perch-stars">
            <circle cx="300" cy="22" r="1.4" />
            <circle cx="384" cy="62" r="1.1" />
            <circle cx="70" cy="30" r="1.2" />
            <circle cx="112" cy="14" r="0.9" />
          </g>
        </Show>
        <path class="perch-bark" d="M0 124 C70 119 160 122 240 120 C300 119 360 117 420 113" />
        <path class="perch-marks" d="M34 122.6 L40 122.4 M96 121.4 L104 121.4 M178 121.6 L183 121.5 M262 120.2 L270 120 M330 118.6 L336 118.3 M392 115.8 L398 115.4" />
        <path class="perch-bud" d="M404 114 C407 107 414 105 418 107 C416 112 410 115 404 114Z" />
      </svg>
      <Show when={particle()}>
        {(kind) => (
          <div class="perch-fall" data-kind={kind()}>
            <For each={[0, 1, 2, 3, 4, 5, 6]}>{(i) => <span style={{ left: `${(i * 37 + 8) % 100}%`, "--i": i }} />}</For>
          </div>
        )}
      </Show>
      <For each={faces()}>
        {(slug, i) => {
          const spot = () => HUDDLE[faces().length]![i()]!
          return (
            <span
              class="perch-bird"
              data-front={spot().front ? "" : undefined}
              style={{ left: `calc(50% + ${spot().dx - spot().size / 2}px)`, top: `${BRANCH_Y - spot().size * FEET}px`, "--i": i() }}
            >
              <Bird spec={spec(slug)} size={spot().size} alive ground={false} />
            </span>
          )
        }}
      </For>
    </div>
  )
}
