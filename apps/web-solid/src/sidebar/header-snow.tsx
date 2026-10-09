import { onCleanup, onMount } from "solid-js"
import { Bird } from "../mascot/bird"
import { YUKI_BIRD } from "../mascot/birds"
import { startSnow } from "../mascot/snow"
import "./header-snow.css"

/*
 * The top of the sidebar: a winter band behind the logo and the search field. A soft light in the
 * accent from the corner, quiet snow, and now and then a little Shima Enaga crossing it the way the
 * real bird flies: a few quick wingbeats up, then a glide down, again and again. It never takes a
 * pointer, and nothing in it moves on navigation. Reduced motion keeps a still band.
 */

const FIRST_FLIGHT_MS = 5_000
const BETWEEN = [22_000, 42_000] as const
const FLIGHT_MS = 5_200

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches

/** The flight path across a band `w` px wide: undulating, as an Enaga's bounding flight is. */
function path(w: number): Keyframe[] {
  const hops = 5
  const frames: Keyframe[] = []
  for (let i = 0; i <= hops * 2; i++) {
    const k = i / (hops * 2)
    const x = -30 + (w + 60) * k
    const y = 34 - (i % 2 ? 10 : 0) - Math.sin(k * Math.PI) * 10
    frames.push({ offset: k, translate: `${x.toFixed(0)}px ${y.toFixed(0)}px`, rotate: i % 2 ? "-6deg" : "4deg", easing: "ease-in-out" })
  }
  return frames
}

export function HeaderSnow() {
  let band: HTMLDivElement | undefined
  let snow: HTMLCanvasElement | undefined
  let flyer: HTMLSpanElement | undefined

  onMount(() => {
    const stopSnow = startSnow(snow!, { density: 0.9, sizes: [0.5, 1.6], alpha: [0.2, 0.7], speed: 0.7, bokeh: 0 })
    let timer: ReturnType<typeof setTimeout> | undefined
    const fly = () => {
      if (band && flyer && !document.hidden) {
        flyer.dataset.flying = ""
        const run = flyer.animate(path(band.clientWidth), { duration: FLIGHT_MS, easing: "linear" })
        run.onfinish = () => flyer && delete flyer.dataset.flying
      }
      timer = setTimeout(fly, BETWEEN[0] + Math.random() * (BETWEEN[1] - BETWEEN[0]))
    }
    if (!reduced()) timer = setTimeout(fly, FIRST_FLIGHT_MS)
    onCleanup(() => (stopSnow(), clearTimeout(timer)))
  })

  return (
    <div ref={band} class="header-snow" data-component="header-snow" aria-hidden="true">
      <div class="header-snow-light" />
      <canvas ref={snow} class="header-snow-flakes" />
      <span ref={flyer} class="header-snow-flyer">
        <Bird spec={YUKI_BIRD} shape="loaf" size={13} />
      </span>
    </div>
  )
}
