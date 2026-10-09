import { onCleanup, onMount } from "solid-js"
import { birdAt, frost, glints, lifeIn, limb, loop, rng, snowOn, spray, yAt, type Pt } from "./paint"
import { startSnow } from "./snow"
import "./hoarfrost.css"

/*
 * The empty chat's picture: one frosted branch across the top of the pane in the theme's own
 * paper and ink, a soft forest blurred behind it, and a huddle of Shima Enaga keeping warm on it.
 * They blink, glance and lean on their own; now and then one shuffles and knocks snow loose. Snow
 * falls through it all. The band fades into the page above the heading. Under reduced motion it
 * is a still picture.
 */

const W = 1180
const H = 380
const HUDDLE = [503, 561, 619, 677]

/** The painting is built once per load from a fixed seed, so it is the same picture every time. */
function paint() {
  const rand = rng(11)
  const branch = limb([[-40, 262], [240, 236], [590, 222], [900, 206], [1220, 178]], 30, 12, 1.2, rand)
  const twigs = [
    limb([[300, 233], [262, 176], [250, 122], [236, 84]], 11, 3, 0.6, rand),
    limb([[880, 207], [930, 152], [990, 118]], 9, 2.5, 0.5, rand),
    limb([[700, 221], [756, 258], [812, 270]], 7, 2, 0.4, rand),
  ]
  const trunks = Array.from({ length: 12 }, () => `<rect x="${(rand() * W).toFixed(0)}" y="-20" width="${(14 + rand() * 54).toFixed(0)}" height="${H + 40}" style="opacity:${(0.03 + rand() * 0.06).toFixed(3)}"/>`).join("")
  const bokeh = Array.from({ length: 14 }, () => `<circle cx="${(rand() * W).toFixed(0)}" cy="${(rand() * H).toFixed(0)}" r="${(16 + rand() * 40).toFixed(0)}" style="opacity:${(0.25 + rand() * 0.35).toFixed(2)}"/>`).join("")
  const needles = [branch, ...twigs].map((l, i) => frost(rand, l.spine, i ? 6 : 9, i ? 6 : 9)).join("")
  const under = frost(rand, branch.spine.map(([x, y]): Pt => [x, y + 13]), 4, 3)
  const birds = HUDDLE.map((x, i) => birdAt({ x, y: yAt(branch.spine, x) - 11, size: 76 - (i % 2) * 4, flip: i < 2, sleepy: i === 2, id: `h${i}` })).join("")
  return { branch, twigs, trunks, bokeh, needles, under, birds, sparks: glints(rand, 22, [0, 70, W, 300], 5) }
}

export function Hoarfrost() {
  const p = paint()
  let canvas!: HTMLCanvasElement
  let root!: SVGGElement
  let bitsLayer!: SVGGElement
  const clocks = new WeakMap<Element, number>()
  const bits = spray(() => bitsLayer)
  let hop = 4

  onMount(() => onCleanup(startSnow(canvas, { density: 0.9, sizes: [0.7, 2.6], speed: 0.55, alpha: [0.35, 0.9], bokeh: 0.08 })))

  loop((_t, dt) => {
    lifeIn(root, dt, clocks)
    bits.step(dt)
    if ((hop -= dt) > 0) return
    hop = 4 + Math.random() * 5
    const i = Math.floor(Math.random() * HUDDLE.length)
    const bird = root.querySelector<SVGSVGElement>(`[data-id="h${i}"] .w-bird`)
    if (!bird || bird.dataset.sleepy !== undefined) return
    bird.style.translate = "0 -7px"
    setTimeout(() => (bird.style.translate = ""), 180)
    bits.add(HUDDLE[i]!, yAt(p.branch.spine, HUDDLE[i]!) + 10, 10, 10)
  })

  return (
    <div class="hoarfrost" data-component="hoarfrost" aria-hidden="true">
      <svg class="hoarfrost-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMin slice">
        <defs>
          <filter id="hoarfrost-far" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="14" />
          </filter>
          <filter id="hoarfrost-rime" x="-5%" y="-20%" width="110%" height="140%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
          <filter id="hoarfrost-bark" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9 0.08" numOctaves="2" seed="3" result="n" />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.9 0.95" result="a" />
            <feComposite in="SourceGraphic" in2="a" operator="in" />
          </filter>
        </defs>
        <g filter="url(#hoarfrost-far)">
          <g class="hoarfrost-trunks" innerHTML={p.trunks} />
          <g class="hoarfrost-bokeh" innerHTML={p.bokeh} />
        </g>
        <g ref={root}>
          <path d={p.twigs[2]!.d} class="hoarfrost-bark" />
          <path d={p.branch.d} class="hoarfrost-bark" />
          <path d={p.branch.d} class="hoarfrost-grain" filter="url(#hoarfrost-bark)" />
          <path d={p.twigs[0]!.d} class="hoarfrost-bark" />
          <path d={p.twigs[1]!.d} class="hoarfrost-bark" />
          <path d={snowOn(p.branch.spine, 9, 11)} class="hoarfrost-rime" filter="url(#hoarfrost-rime)" />
          <path d={snowOn(p.branch.spine, 7, 10)} class="hoarfrost-snow" />
          <path d={snowOn(p.twigs[0]!.spine, 4, 3)} class="hoarfrost-snow" />
          <path d={p.needles} class="hoarfrost-needles" />
          <path d={p.under} class="hoarfrost-needles hoarfrost-needles-under" />
          <g innerHTML={p.birds} />
          <g ref={bitsLayer} class="hoarfrost-bits" />
          <g class="hoarfrost-glints" innerHTML={p.sparks} />
        </g>
      </svg>
      <canvas ref={canvas} class="hoarfrost-snowfall" />
    </div>
  )
}
