// Six snowy empty chats, each a place real Shima Enaga live: Hokkaido's winter woods, painted in
// layers with depth of field, haze, snow at many depths and light that glints. Open
// /src/mascot/winter.html on the dev server; `?mode=dark` shows each place at night.

import { onCleanup, onMount, type JSX } from "solid-js"
import { render } from "solid-js/web"
import "../styles/app.css"
import { applyCommitted } from "../theme/apply"
import { DEFAULT_LOOK } from "../theme/look"
import { VIEWBOX } from "./birds"
import { bareTree, birdAt, clamp, curve, f1, frost, glints, lifeIn, limb, loop, rng, segs, smooth, snowOn, spray, yAt, type Pt } from "./paint"
import { startSnow, type SnowOptions } from "./snow"
import "./winter.css"

const mode = new URLSearchParams(location.search).get("mode") === "dark" ? "dark" : "light"
applyCommitted({ ...DEFAULT_LOOK, mode })

const W = 1180
const H = 660
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches


/** A rolling ridge line for mountains or drifts, closed down to the bottom of the picture. */
function ridge(rand: () => number, base: number, amp: number, rough: number): string {
  const pts: Pt[] = []
  const phase = rand() * 10
  for (let x = -20; x <= W + 20; x += 20) {
    const y = base - amp * (0.55 * Math.sin(x / 210 + phase) + 0.3 * Math.sin(x / 83 + phase * 2) + 0.15 * Math.sin(x / 37 + phase * 3)) - rough * rand()
    pts.push([x, y])
  }
  return `M-20 ${H} L${pts.map(([x, y]) => `${f1(x)} ${f1(y)}`).join(" L")} L${W + 20} ${H}Z`
}


// ----- the frame ----------------------------------------------------------------------------

function Pane(props: { n: string; title: string; jp: string; note?: string; desc: string; class: string; snow?: SnowOptions; children: JSX.Element; over?: JSX.Element }) {
  let canvas!: HTMLCanvasElement
  onMount(() => {
    if (props.snow) onCleanup(startSnow(canvas, props.snow))
  })
  return (
    <section>
      <div class="w-label">
        <span>{props.n}</span>
        <h2>
          {props.title} <i>{props.jp}</i>
          {props.note && <em>{props.note}</em>}
        </h2>
        <p>{props.desc}</p>
      </div>
      <div class={`w-pane ${props.class}`}>
        <svg class="w-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          {props.children}
        </svg>
        <canvas ref={canvas} class="w-snow" />
        {props.over}
        <div class="w-hero">
          <h3>What's on your mind?</h3>
          <div class="w-composer">Message Yuki</div>
        </div>
      </div>
    </section>
  )
}

/** The blurs that make depth: far is very soft, near is a touch soft. */
function Defs(props: { id: string }) {
  return (
    <defs>
      <filter id={`${props.id}-far`} x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="14" />
      </filter>
      <filter id={`${props.id}-mid`} x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="4" />
      </filter>
      <filter id={`${props.id}-soft`} x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="1.2" />
      </filter>
      <filter id={`${props.id}-bark`} x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9 0.08" numOctaves="2" seed="3" result="n" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.9 0.95" result="a" />
        <feComposite in="SourceGraphic" in2="a" operator="in" />
      </filter>
    </defs>
  )
}

// ----- 1. Hoarfrost branch ------------------------------------------------------------------

function Hoarfrost() {
  const rand = rng(11)
  let root!: SVGGElement
  let bitsLayer!: SVGGElement
  const branch = limb([[-30, 268], [240, 232], [520, 214], [800, 200], [1060, 178], [1220, 150]], 34, 12, 1.2, rand)
  const twigA = limb([[300, 228], [262, 170], [250, 112], [236, 70]], 12, 3, 0.6, rand)
  const twigB = limb([[880, 196], [930, 140], [990, 104]], 10, 2.5, 0.5, rand)
  const twigC = limb([[640, 210], [700, 252], [760, 268]], 8, 2, 0.4, rand)
  const xs = [508, 566, 624, 684]
  const birds = xs.map((x, i) => birdAt({ x, y: yAt(branch.spine, x) - 12, size: 78 - (i % 2) * 4, flip: i < 2, sleepy: i === 2, id: `h${i}` }))
  const bokeh = Array.from({ length: 16 }, () => `<circle cx="${f1(rand() * W)}" cy="${f1(rand() * H * 0.8)}" r="${f1(18 + rand() * 46)}" class="w-bokeh" style="opacity:${(0.15 + rand() * 0.3).toFixed(2)}"/>`).join("")
  const trunks = Array.from({ length: 11 }, () => `<rect x="${f1(rand() * W)}" y="-20" width="${f1(14 + rand() * 50)}" height="${H + 40}" class="w-far-trunk" style="opacity:${(0.25 + rand() * 0.4).toFixed(2)}"/>`).join("")
  const needles = [branch, twigA, twigB, twigC].map((l, i) => frost(rand, l.spine, i ? 6 : 9, i ? 6 : 9)).join("")
  const under = frost(rand, branch.spine.map(([x, y]) => [x, y + 15] as const), 4, 3)
  const sparks = glints(rand, 26, [0, 60, W, 300], 6)
  const clocks = new WeakMap<Element, number>()
  const bits = spray(() => bitsLayer)
  let hop = 4
  loop((_t, dt) => {
    lifeIn(root, dt, clocks)
    bits.step(dt)
    // Now and then one of the huddle shuffles closer, and knocks a little snow off the branch.
    if ((hop -= dt) <= 0) {
      hop = 4 + Math.random() * 5
      const i = Math.floor(Math.random() * xs.length)
      if (i === 2) return
      const g = root.querySelector<SVGGElement>(`[data-id="h${i}"] .w-bird`)
      if (!g) return
      g.style.translate = `0 -7px`
      setTimeout(() => (g.style.translate = ""), 180)
      bits.add(xs[i]!, yAt(branch.spine, xs[i]!) + 10, 10, 10)
    }
  })
  return (
    <Pane n="1" title="Hoarfrost branch" jp="霧氷" note="my pick" class="w-frost" snow={{ density: 1.1, sizes: [0.7, 2.8], speed: 0.6, alpha: [0.3, 0.85], bokeh: 0.1 }}
      desc="A close-up of one frosted branch against a blurred winter forest. The huddle fluffs, blinks and shuffles closer, knocking a little snow loose. Frost crystals glint as the light moves.">
      <Defs id="hf" />
      <rect width={W} height={H} class="w-sky" />
      <g filter="url(#hf-far)" innerHTML={trunks + bokeh} />
      <g ref={root}>
        <path d={twigC.d} class="w-bark" />
        <path d={branch.d} class="w-bark" />
        <path d={branch.d} class="w-bark-grain" filter="url(#hf-bark)" />
        <path d={twigA.d} class="w-bark" />
        <path d={twigB.d} class="w-bark" />
        <path d={snowOn(branch.spine, 9, 12)} class="w-rime" filter="url(#hf-mid)" />
        <path d={snowOn(branch.spine, 7, 11)} class="w-snowlay" />
        <path d={snowOn(twigA.spine, 4, 3)} class="w-snowlay" />
        <path d={needles} class="w-needles" />
        <path d={under} class="w-needles w-needles-under" />
        <g innerHTML={birds.join("")} />
        <g ref={bitsLayer} />
        <g innerHTML={sparks} />
      </g>
    </Pane>
  )
}

// ----- 2. Birch forest at dawn --------------------------------------------------------------

function birch(rand: () => number, x: number, w: number, top: number, bottom: number, cls: string): string {
  const lean = (rand() - 0.5) * 18
  const body = limb([[x, bottom], [x + lean * 0.5, (top + bottom) / 2], [x + lean, top]], w, w * 0.82, 0.8, rand)
  let marks = ""
  for (let y = top + 10; y < bottom - 10; y += 16 + rand() * 46) {
    const cx = x + lean * ((bottom - y) / (bottom - top)) * 0 + lean * (1 - (y - top) / (bottom - top)) + (rand() - 0.5) * w * 0.6
    const len = w * (0.12 + rand() * 0.38)
    const th = 1 + rand() * 2.2
    const sag = (rand() - 0.5) * 3
    marks += `<path d="M${f1(cx - len / 2)} ${f1(y)} Q${f1(cx)} ${f1(y + sag)} ${f1(cx + len / 2)} ${f1(y + rand() * 2)} L${f1(cx + len / 2)} ${f1(y + th)} Q${f1(cx)} ${f1(y + sag + th * 1.3)} ${f1(cx - len / 2)} ${f1(y + th * 0.7)}Z" class="w-birch-mark" style="opacity:${(0.45 + rand() * 0.5).toFixed(2)}"/>`
    if (rand() < 0.1) marks += `<path d="M${f1(cx - w * 0.3)} ${f1(y + 6)} Q${f1(cx)} ${f1(y - 2)} ${f1(cx + w * 0.3)} ${f1(y + 6)} Q${f1(cx)} ${f1(y + 16)} ${f1(cx - w * 0.3)} ${f1(y + 6)}Z" class="w-birch-eye"/>`
  }
  return `<g class="${cls}"><path d="${body.d}" class="w-birch"/><path d="${body.d}" fill="url(#bw-round)"/>${marks}</g>`
}

function Birch() {
  const rand = rng(23)
  let root!: SVGGElement
  let hanger!: SVGGElement
  let flyer!: SVGGElement
  const far = Array.from({ length: 16 }, () => birch(rand, rand() * W, 7 + rand() * 7, -20, 470 + rand() * 20, "w-layer-far")).join("")
  const mid = Array.from({ length: 7 }, () => birch(rand, rand() * W, 16 + rand() * 12, -20, 500 + rand() * 20, "w-layer-mid")).join("")
  const near = [birch(rand, 74, 58, -30, H + 20, ""), birch(rand, 1108, 66, -30, H + 20, "")].join("")
  const boughL = limb([[86, 236], [200, 214], [320, 206], [400, 214]], 9, 2, 0.4, rand)
  const boughR = limb([[1094, 168], [990, 150], [880, 142], [800, 150]], 10, 2, 0.4, rand)
  const twigs = [
    ...bareTree(rand, 300, 208, 30, -2.1, 2.2, 3),
    ...bareTree(rand, 360, 210, 26, -1.2, 2, 3),
    ...bareTree(rand, 940, 146, 34, -1.9, 2.4, 3),
    ...bareTree(rand, 860, 144, 26, -1.1, 2, 3),
  ]
  const shadows = Array.from({ length: 9 }, () => {
    const x = rand() * W * 1.2
    return `<path d="M${f1(x)} 480 L${f1(x - 340)} ${H} L${f1(x - 300)} ${H} L${f1(x + 12)} 480Z" class="w-shadow"/>`
  }).join("")
  const sparks = glints(rand, 40, [0, 40, W, 440], 4)
  const hang: Pt = [338, 212]
  const perchA: Pt = [912, 146]
  const perchB: Pt = [222, 211]
  const clocks = new WeakMap<Element, number>()
  const FW = (34 * VIEWBOX.loaf[2]) / VIEWBOX.loaf[3]
  loop((t, dt) => {
    lifeIn(root, dt, clocks)
    // The acrobat: hanging upside down from a twig, swinging a little as it feeds.
    hanger.setAttribute("transform", `rotate(${f1(Math.sin(t * 1.3) * 7)} ${hang[0]} ${hang[1]})`)
    // The flitter: perched, then a bounding hop of a flight to the other bough, and back.
    const k = t % 14
    const there = k > 7
    const p = smooth(((k % 7) - 4.6) / 1.6)
    const [ax, ay] = there ? perchB : perchA
    const [bx, by] = there ? perchA : perchB
    const x = ax + (bx - ax) * p
    const y = ay + (by - ay) * p - Math.sin(p * Math.PI) * 70 - Math.abs(Math.sin(p * Math.PI * 4)) * 10 * Math.sin(p * Math.PI)
    const left = bx < ax
    flyer.setAttribute("transform", `translate(${f1(x - FW / 2)} ${f1(y - 34 * 0.95)})${left ? ` translate(${f1(FW)} 0) scale(-1 1)` : ""}`)
    flyer.classList.toggle("w-flying", p > 0 && p < 1)
  })
  return (
    <Pane n="2" title="Birch forest at dawn" jp="白樺" class="w-birchwood" snow={{ density: 0.35, sizes: [0.5, 1.6], speed: 0.4, alpha: [0.3, 0.9], bokeh: 0.02 }}
      desc="Layers of white birch fading into mist, a low pink sun behind them, diamond dust sparkling in the air. One bird hangs upside down to feed, another flits between the boughs.">
      <Defs id="bw" />
      <defs>
        <linearGradient id="bw-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ "stop-color": "var(--sky-top)" }} />
          <stop offset="0.55" style={{ "stop-color": "var(--sky-mid)" }} />
          <stop offset="0.8" style={{ "stop-color": "var(--sky-low)" }} />
        </linearGradient>
        <linearGradient id="bw-round" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ "stop-color": "#3d4a66", "stop-opacity": 0.32 }} />
          <stop offset="0.3" style={{ "stop-color": "#3d4a66", "stop-opacity": 0 }} />
          <stop offset="0.72" style={{ "stop-color": "#fff3e4", "stop-opacity": 0.25 }} />
          <stop offset="1" style={{ "stop-color": "#3d4a66", "stop-opacity": 0.18 }} />
        </linearGradient>
        <radialGradient id="bw-sun" cx="0.72" cy="0.62" r="0.5">
          <stop offset="0" style={{ "stop-color": "var(--sun)", "stop-opacity": 0.95 }} />
          <stop offset="1" style={{ "stop-color": "var(--sun)", "stop-opacity": 0 }} />
        </radialGradient>
        <linearGradient id="bw-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ "stop-color": "var(--snow-top)" }} />
          <stop offset="1" style={{ "stop-color": "var(--snow-low)" }} />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="url(#bw-sky)" />
      <rect width={W} height={H} fill="url(#bw-sun)" />
      <g filter="url(#bw-far)" innerHTML={far} />
      <rect y="360" width={W} height="160" class="w-mist" filter="url(#bw-far)" />
      <path d={ridge(rand, 488, 10, 2)} fill="url(#bw-ground)" />
      <g innerHTML={shadows} />
      <g filter="url(#bw-mid)" innerHTML={mid} />
      <g ref={root}>
        <g innerHTML={near} />
        <path d={boughL.d} class="w-twig-fill" />
        <path d={boughR.d} class="w-twig-fill" />
        <g innerHTML={segs(twigs, "stroke:var(--twig)")} />
        <path d={snowOn(boughL.spine, 3, 3)} class="w-snowlay" />
        <path d={snowOn(boughR.spine, 3.5, 3)} class="w-snowlay" />
        <g ref={hanger} innerHTML={birdAt({ x: hang[0], y: hang[1], size: 50, rotate: 180 })} />
        <g ref={flyer} class="w-flyer" innerHTML={birdAt({ x: FW / 2, y: 34 * 0.95, size: 34, shape: "loaf" })} />
        <g innerHTML={birdAt({ x: 1010, y: 152, size: 54, flip: true })} />
        <g innerHTML={sparks} class="w-dust" />
      </g>
    </Pane>
  )
}

// ----- 3. Sap icicles -----------------------------------------------------------------------

function Icicles() {
  const rand = rng(37)
  let root!: SVGGElement
  let licker!: SVGGElement
  let drop!: SVGCircleElement
  const branch = limb([[-30, 150], [260, 172], [560, 160], [860, 140], [1210, 118]], 36, 16, 1.4, rand)
  const sprig = limb([[690, 150], [740, 104], [790, 76], [830, 66]], 12, 3, 0.5, rand)
  const tips = [300, 372, 452, 540, 618, 700, 790].map((x) => {
    const top = yAt(branch.spine, x) + 2
    return { x, top, len: 50 + rand() * 120, w: 7 + rand() * 7 }
  })
  const ice = tips
    .map(({ x, top, len, w }) => {
      const bend = (rand() - 0.5) * 6
      return (
        `<path d="M${f1(x - w)} ${f1(top)} C${f1(x - w * 0.8)} ${f1(top + len * 0.4)} ${f1(x - 1.5 + bend)} ${f1(top + len * 0.8)} ${f1(x + bend)} ${f1(top + len)} C${f1(x + 1.5 + bend)} ${f1(top + len * 0.8)} ${f1(x + w * 0.8)} ${f1(top + len * 0.4)} ${f1(x + w)} ${f1(top)}Z" class="w-ice"/>` +
        `<path d="M${f1(x - w * 0.35)} ${f1(top + 4)} Q${f1(x - w * 0.25 + bend * 0.5)} ${f1(top + len * 0.5)} ${f1(x + bend * 0.9)} ${f1(top + len * 0.9)}" class="w-ice-shine"/>`
      )
    })
    .join("")
  const bokeh = Array.from({ length: 22 }, () => `<circle cx="${f1(rand() * W)}" cy="${f1(rand() * H * 0.85)}" r="${f1(14 + rand() * 50)}" class="w-bokeh-warm" style="opacity:${(0.18 + rand() * 0.4).toFixed(2)}"/>`).join("")
  const sparks = glints(rand, 18, [260, 160, 820, 340], 7)
  const clocks = new WeakMap<Element, number>()
  const LH = 40
  const LW = (LH * VIEWBOX.loaf[2]) / VIEWBOX.loaf[3]
  // Where the beak is on the loaf, as a share of its box.
  const BEAK = [(102 - VIEWBOX.loaf[0]) / VIEWBOX.loaf[2], (70.5 - VIEWBOX.loaf[1]) / VIEWBOX.loaf[3]] as const
  const rest: Pt = [960, yAt(branch.spine, 960) - 14]
  let pick = 2
  loop((t, dt) => {
    lifeIn(root, dt, clocks)
    // A cycle: rest on the branch, flutter to an icicle's tip, lick the sweet drop, flutter back.
    const k = t % 12
    const tip = tips[pick]!
    const at: Pt = [tip.x - BEAK[0] * LW, tip.top + tip.len - BEAK[1] * LH + 2]
    const perch: Pt = [rest[0] - LW / 2, rest[1] - LH * 0.95]
    let x = perch[0]
    let y = perch[1]
    let flying = false
    if (k > 2 && k < 3.4) {
      const p = smooth((k - 2) / 1.4)
      x = perch[0] + (at[0] - perch[0]) * p
      y = perch[1] + (at[1] - perch[1]) * p - Math.sin(p * Math.PI) * 50
      flying = true
    } else if (k >= 3.4 && k < 8) {
      x = at[0] + Math.sin(t * 6) * 1.2 - Math.max(0, Math.sin(t * 2.4)) * 2
      y = at[1] + Math.sin(t * 9) * 1.5
      flying = true
    } else if (k >= 8 && k < 9.4) {
      const p = smooth((k - 8) / 1.4)
      x = at[0] + (perch[0] - at[0]) * p
      y = at[1] + (perch[1] - at[1]) * p - Math.sin(p * Math.PI) * 50
      flying = true
    } else if (k >= 11.9) pick = Math.floor(Math.random() * tips.length)
    // It flies out facing the icicles and licks with its beak to the tip.
    const outbound = k > 2 && k < 3.4
    licker.setAttribute("transform", `translate(${f1(x)} ${f1(y)})${outbound ? ` translate(${f1(LW)} 0) scale(-1 1)` : ""}`)
    licker.classList.toggle("w-flying", flying)
    // The drop at a tip swells, and when the bird is not there it falls and glints.
    const d = tips[(pick + 3) % tips.length]!
    const dk = t % 5
    const r = dk < 3.6 ? 1 + (dk / 3.6) * 2.6 : 3.6
    const fall = dk < 3.6 ? 0 : (dk - 3.6) ** 2 * 260
    drop.setAttribute("cx", f1(d.x))
    drop.setAttribute("cy", f1(d.top + d.len + r + fall))
    drop.setAttribute("r", f1(r))
    drop.style.opacity = String(1 - clamp((dk - 4.4) / 0.6))
  })
  return (
    <Pane n="3" title="Sap icicles" jp="つらら" class="w-sap" snow={{ density: 0.4, sizes: [0.6, 2], speed: 0.45, alpha: [0.3, 0.9], bokeh: 0.03 }}
      desc="A maple branch hung with sweet sap icicles in morning sun. An Enaga flutters down and licks a tip, then goes back to the branch. Drops swell, glint and fall. Real Shima Enaga do this every winter.">
      <Defs id="si" />
      <rect width={W} height={H} class="w-sky" />
      <g filter="url(#si-far)" innerHTML={bokeh} />
      <g ref={root}>
        <defs>
          <linearGradient id="si-ice" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" style={{ "stop-color": "#cfe3f1", "stop-opacity": 0.75 }} />
            <stop offset="0.4" style={{ "stop-color": "#ffffff", "stop-opacity": 0.35 }} />
            <stop offset="0.75" style={{ "stop-color": "#e8f2fa", "stop-opacity": 0.6 }} />
            <stop offset="1" style={{ "stop-color": "#a9c4da", "stop-opacity": 0.8 }} />
          </linearGradient>
        </defs>
        <g innerHTML={ice} />
        <path d={sprig.d} class="w-bark" />
        <path d={branch.d} class="w-bark" />
        <path d={branch.d} class="w-bark-grain" filter="url(#si-bark)" />
        <path d={snowOn(branch.spine, 12, 15)} class="w-snowlay" />
        <circle ref={drop} class="w-drop" r="2" />
        <g innerHTML={birdAt({ x: 1060, y: yAt(branch.spine, 1060) - 14, size: 60, flip: true, sleepy: true })} />
        <g ref={licker} class="w-flyer" innerHTML={birdAt({ x: LW / 2, y: LH * 0.95, size: LH, shape: "loaf" })} />
        <g innerHTML={sparks} />
      </g>
    </Pane>
  )
}

// ----- 4. Frozen lake at blue hour ----------------------------------------------------------

function Lake() {
  const rand = rng(51)
  let root!: SVGGElement
  const far = ridge(rand, 300, 70, 4)
  const mid = ridge(rand, 336, 44, 6)
  const firs = Array.from({ length: 90 }, () => {
    const x = rand() * W
    const h = 14 + rand() * 30
    const b = 362 + rand() * 6
    return `M${f1(x)} ${f1(b - h)} L${f1(x + h * 0.22)} ${f1(b)} L${f1(x - h * 0.22)} ${f1(b)}Z`
  }).join(" ")
  const cracks = Array.from({ length: 12 }, () => {
    let x = rand() * W
    let y = 400 + rand() * 240
    let d = `M${f1(x)} ${f1(y)}`
    for (let i = 0; i < 6; i++) {
      x += (rand() - 0.3) * 60
      y += (rand() - 0.5) * 14
      d += ` L${f1(x)} ${f1(y)}`
    }
    return d
  }).join(" ")
  const drifts = Array.from({ length: 9 }, () => `<ellipse cx="${f1(rand() * W)}" cy="${f1(420 + rand() * 220)}" rx="${f1(60 + rand() * 160)}" ry="${f1(4 + rand() * 9)}" class="w-ice-snow"/>`).join("")
  const trees = [
    { x: 150, y: 452, len: 74, w: 7 },
    { x: 262, y: 432, len: 52, w: 5 },
    { x: 1000, y: 470, len: 96, w: 9 },
    { x: 1104, y: 440, len: 60, w: 6 },
  ]
  const standing = trees.map((t) => segs(bareTree(rand, t.x, t.y, t.len, -Math.PI / 2 + (rand() - 0.5) * 0.12, t.w, 5), "stroke:var(--tree)")).join("")
  const reflect = trees.map((t) => segs(bareTree(rng(t.x), t.x, t.y, t.len * 0.8, Math.PI / 2, t.w, 3), "stroke:var(--tree)")).join("")
  const perch = limb([[1000, 392], [1040, 386], [1078, 378]], 6, 2, 0.2, rand)
  const stars = Array.from({ length: 70 }, () => `<circle cx="${f1(rand() * W)}" cy="${f1(rand() * 250)}" r="${f1(0.4 + rand() * 1.1)}" class="w-star" style="animation-delay:${f1(-rand() * 5)}s"/>`).join("")
  const clocks = new WeakMap<Element, number>()
  loop((_t, dt) => lifeIn(root, dt, clocks))
  return (
    <Pane n="4" title="Frozen lake at blue hour" jp="青い時間" class="w-lake" snow={{ density: 0.5, sizes: [0.6, 2.2], speed: 0.35, alpha: [0.3, 0.85], bokeh: 0.03 }}
      desc="A teal frozen lake with bare trees standing in the ice, mountains going blue, slow snow. One bird sits on a lone branch while the light slowly deepens. The calmest of the six.">
      <Defs id="lk" />
      <defs>
        <linearGradient id="lk-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ "stop-color": "var(--sky-top)" }} />
          <stop offset="0.38" style={{ "stop-color": "var(--sky-mid)" }} />
          <stop offset="0.55" style={{ "stop-color": "var(--sky-low)" }} />
        </linearGradient>
        <linearGradient id="lk-ice" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ "stop-color": "var(--ice-far)" }} />
          <stop offset="1" style={{ "stop-color": "var(--ice-near)" }} />
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill="url(#lk-sky)" />
      <g innerHTML={stars} class="w-stars" />
      <rect width={W} height={H} class="w-dusk" />
      <path d={far} class="w-mtn-far" filter="url(#lk-soft)" />
      <path d={mid} class="w-mtn-mid" />
      <path d={firs} class="w-firs" />
      <rect y="364" width={W} height={H - 364} fill="url(#lk-ice)" />
      <g transform={`translate(0 ${364 * 2}) scale(1 -1)`} opacity="0.18" filter="url(#lk-mid)">
        <path d={mid} class="w-mtn-mid" />
        <path d={firs} class="w-firs" />
      </g>
      <path d={cracks} class="w-cracks" />
      <g innerHTML={drifts} filter="url(#lk-soft)" />
      <g innerHTML={reflect} opacity="0.16" filter="url(#lk-mid)" />
      <g ref={root}>
        <g innerHTML={standing} />
        <path d={perch.d} style={{ fill: "var(--tree)" }} />
        <g innerHTML={birdAt({ x: 1048, y: 386, size: 44 })} />
      </g>
    </Pane>
  )
}

// ----- 5. Lantern garden at night -----------------------------------------------------------

function Lantern() {
  const rand = rng(67)
  let root!: SVGGElement
  let glow!: SVGCircleElement
  const LX = 940
  const fence = Array.from({ length: 60 }, (_, i) => `<rect x="${f1(-10 + i * 21)}" y="${f1(268 + rand() * 6)}" width="16" height="230" rx="3" class="w-fence"/>`).join("")
  const fenceSnow = `<rect x="-10" y="262" width="${W + 20}" height="9" rx="4.5" class="w-snowfill"/><rect x="-10" y="368" width="${W + 20}" height="6" rx="3" class="w-fence-tie"/>`
  const pines = Array.from({ length: 9 }, () => {
    const x = rand() * W
    const h = 220 + rand() * 160
    return `<path d="M${f1(x)} ${f1(300 - h)} L${f1(x + h * 0.32)} 320 L${f1(x - h * 0.32)} 320Z" class="w-pine-far"/>`
  }).join("")
  const ground = ridge(rand, 520, 14, 2)
  const bough = limb([[-30, 70], [140, 92], [300, 120], [420, 160]], 16, 4, 0.8, rand)
  const needles = bough.spine
    .filter((_, i) => i % 2 === 0)
    .map(([x, y]) => Array.from({ length: 7 }, (_, k) => {
      const a = -Math.PI / 2 + (k - 3) * 0.42 + (rand() - 0.5) * 0.2
      const l = 16 + rand() * 12
      return `M${f1(x)} ${f1(y)} L${f1(x + Math.cos(a) * l)} ${f1(y + Math.sin(a) * l + 22)}`
    }).join(" "))
    .join(" ")
  const clocks = new WeakMap<Element, number>()
  loop((t, dt) => {
    lifeIn(root, dt, clocks)
    // The candle breathes: never a strobe, just a slow warm flicker.
    glow.style.opacity = f1(0.82 + Math.sin(t * 2.1) * 0.06 + Math.sin(t * 5.3) * 0.04)
  })
  return (
    <Pane n="5" title="Lantern garden at night" jp="雪見灯籠" class="w-lantern" snow={{ density: 0.8, sizes: [0.7, 2.6], speed: 0.5, alpha: [0.35, 0.9], bokeh: 0.06 }}
      over={<div class="w-lantern-light" />}
      desc="Deep snow in a quiet Japanese garden. A stone snow-viewing lantern glows warm, and flakes catch its light as they pass. A bird dozes on the lantern's snowy roof and wakes now and then. The coziest.">
      <Defs id="lg" />
      <defs>
        <radialGradient id="lg-glow">
          <stop offset="0" style={{ "stop-color": "#ffcf86", "stop-opacity": 0.75 }} />
          <stop offset="0.35" style={{ "stop-color": "#ffb45e", "stop-opacity": 0.25 }} />
          <stop offset="1" style={{ "stop-color": "#ff9a40", "stop-opacity": 0 }} />
        </radialGradient>
        <linearGradient id="lg-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ "stop-color": "var(--snow-top)" }} />
          <stop offset="1" style={{ "stop-color": "var(--snow-low)" }} />
        </linearGradient>
      </defs>
      <rect width={W} height={H} class="w-sky" />
      <g filter="url(#lg-far)" innerHTML={pines} />
      <g filter="url(#lg-mid)" innerHTML={fence + fenceSnow} />
      <path d={ground} fill="url(#lg-ground)" />
      <ellipse cx={LX} cy="528" rx="220" ry="26" class="w-lantern-pool" filter="url(#lg-mid)" />
      <circle ref={glow} cx={LX} cy="400" r="320" fill="url(#lg-glow)" />
      <g ref={root}>
        {/* The lantern: three curved legs, the light box, a wide roof under a thick cap of snow. */}
        <path d={`M${LX - 70} 528 C${LX - 64} 490 ${LX - 44} 452 ${LX - 30} 436 L${LX - 18} 436 C${LX - 32} 460 ${LX - 46} 494 ${LX - 52} 528Z`} class="w-stone" />
        <path d={`M${LX + 70} 528 C${LX + 64} 490 ${LX + 44} 452 ${LX + 30} 436 L${LX + 18} 436 C${LX + 32} 460 ${LX + 46} 494 ${LX + 52} 528Z`} class="w-stone" />
        <path d={`M${LX - 9} 520 C${LX - 6} 486 ${LX - 4} 460 ${LX - 4} 436 L${LX + 6} 436 C${LX + 6} 460 ${LX + 8} 486 ${LX + 11} 520Z`} class="w-stone w-stone-back" />
        <rect x={LX - 62} y="424" width="124" height="16" rx="3" class="w-stone" />
        <rect x={LX - 44} y="354" width="88" height="72" rx="4" class="w-stone" />
        <rect x={LX - 30} y="364" width="60" height="52" rx="2" class="w-window" />
        <path d={`M${LX - 30} 390 L${LX + 30} 390 M${LX} 364 L${LX} 416`} class="w-window-bar" />
        <path d={`M${LX - 138} 356 Q${LX - 70} 340 ${LX} 314 Q${LX + 70} 340 ${LX + 138} 356 L${LX + 126} 362 L${LX - 126} 362Z`} class="w-stone" />
        <path d={`M${LX - 148} 352 C${LX - 140} 322 ${LX - 90} 296 ${LX - 20} 286 C${LX + 30} 280 ${LX + 110} 300 ${LX + 150} 350 C${LX + 120} 362 ${LX - 120} 362 ${LX - 148} 352Z`} class="w-snowfill w-cap" />
        <path d={`M${LX - 60} 432 Q${LX} 424 ${LX + 60} 432 L${LX + 62} 424 L${LX - 62} 424Z`} class="w-snowfill" />
        <g innerHTML={birdAt({ x: LX + 6, y: 292, size: 66, sleepy: true })} />
        <path d={bough.d} class="w-pine" />
        <path d={needles} class="w-pine-needles" />
        <path d={snowOn(bough.spine, 10, 6)} class="w-snowfill" />
      </g>
    </Pane>
  )
}

// ----- 6. Heavy snowfall --------------------------------------------------------------------

function Snowfall() {
  const rand = rng(83)
  let root!: SVGGElement
  let bitsLayer!: SVGGElement
  const firs = Array.from({ length: 14 }, () => {
    const x = rand() * W
    const h = 200 + rand() * 260
    const b = 560
    let d = ""
    for (let k = 0; k < 4; k++) {
      const y = b - h + (k * h) / 4.4
      const w = h * (0.12 + k * 0.07)
      d += `M${f1(x)} ${f1(y)} L${f1(x + w)} ${f1(y + h * 0.34)} L${f1(x - w)} ${f1(y + h * 0.34)}Z `
    }
    return `<path d="${d}" class="w-fir" style="opacity:${(0.25 + rand() * 0.35).toFixed(2)}"/>`
  }).join("")
  const twig = limb([[1220, 190], [1080, 214], [940, 228], [820, 238], [730, 236]], 20, 5, 1, rand)
  const side = [...bareTree(rand, 1000, 220, 40, -2.3, 3, 2), ...bareTree(rand, 880, 232, 30, -0.9, 2.4, 2), ...bareTree(rand, 960, 226, 26, 1.6, 2, 1)]
  const BX = 860
  const clocks = new WeakMap<Element, number>()
  const bits = spray(() => bitsLayer)
  let shake = 9
  loop((_t, dt) => {
    lifeIn(root, dt, clocks)
    bits.step(dt)
    // Every so often it shakes the snow off its back.
    if ((shake -= dt) <= 0) {
      shake = 9 + Math.random() * 6
      const b = root.querySelector<SVGSVGElement>(".w-bird")
      if (!b) return
      let n = 0
      const wiggle = () => {
        b.style.setProperty("--tilt", `${n % 2 ? 9 : -9}deg`)
        if (++n < 6) setTimeout(wiggle, 70)
        else b.style.setProperty("--tilt", "0deg")
      }
      wiggle()
      bits.add(BX, yAt(twig.spine, BX) - 50, 18, 60)
    }
  })
  return (
    <Pane n="6" title="Heavy snowfall" jp="大雪" class="w-heavy" snow={{ density: 2.4, sizes: [0.8, 4.2], speed: 0.85, alpha: [0.25, 0.9], bokeh: 0.14 }}
      desc="No place in particular: big soft flakes in sharp focus near you and a blur of them far off. One bird on a snow-laden twig turns its head now and then and shakes off its back. The quietest behind long chats.">
      <Defs id="hs" />
      <rect width={W} height={H} class="w-sky" />
      <g filter="url(#hs-far)" innerHTML={firs} />
      <rect y="420" width={W} height="240" class="w-mist" filter="url(#hs-far)" />
      <g ref={root} filter="url(#hs-soft)">
        <path d={twig.d} class="w-bark" />
        <g innerHTML={segs(side, "stroke:var(--bark)")} />
        <path d={snowOn(twig.spine, 16, 7)} class="w-snowfill" filter="url(#hs-soft)" />
        <path d={snowOn(twig.spine.map(([x, y], i) => [x, y - Math.sin(i * 0.9) * 3] as const), 12, 8)} class="w-snowfill" />
        <g innerHTML={birdAt({ x: BX, y: yAt(twig.spine, BX) - 8, size: 72, flip: true })} />
        <g ref={bitsLayer} />
      </g>
    </Pane>
  )
}

function Page() {
  return (
    <main class="w-page">
      <header>
        <h1>Six snowy places</h1>
        <p>
          Where Shima Enaga really live: Hokkaido's winter woods. Painted in layers with depth, haze, falling snow and glinting light, live under the real heading and composer.{" "}
          <a href={mode === "dark" ? "?mode=light" : "?mode=dark"}>{mode === "dark" ? "See day" : "See night"}</a>
        </p>
      </header>
      <Hoarfrost />
      <Birch />
      <Icicles />
      <Lake />
      <Lantern />
      <Snowfall />
    </main>
  )
}

render(() => <Page />, document.getElementById("root")!)
