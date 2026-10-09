// Three empty chats in Yuki's own language, sumi ink and snow, live: a brush that paints the
// birds in, snow that settles into drifts, and a flock that writes shapes in the air. Open
// /src/mascot/ink.html on the dev server; `?mode=dark` shows the night version.

import { onCleanup, onMount, type JSX } from "solid-js"
import { render } from "solid-js/web"
import "../styles/app.css"
import { applyCommitted } from "../theme/apply"
import { DEFAULT_LOOK } from "../theme/look"
import { Bird } from "./bird"
import { birdSvg, VIEWBOX, YUKI_BIRD, type BirdShape } from "./birds"
import { startSnow } from "./snow"
import "./ink.css"

const mode = new URLSearchParams(location.search).get("mode") === "dark" ? "dark" : "light"
applyCommitted({ ...DEFAULT_LOOK, mode })

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
const ease = (p: number) => 1 - (1 - clamp(p)) ** 3
const smooth = (p: number) => 0.5 - Math.cos(Math.PI * clamp(p)) / 2
const rand = (a: number, b: number) => a + Math.random() * (b - a)
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches

/** Runs `frame(t, dt)` every animation frame while mounted. Nothing under reduced motion. */
function loop(frame: (t: number, dt: number) => void) {
  onMount(() => {
    if (reduced) return
    let raf = 0
    let last = 0
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (t - (last || t)) / 1000)
      last = t
      frame(t, dt)
    }
    raf = requestAnimationFrame(tick)
    onCleanup(() => cancelAnimationFrame(raf))
  })
}

function Pane(props: { n: string; title: string; note: string; desc: string; children: JSX.Element; class: string }) {
  return (
    <section>
      <div class="ink-label">
        <span>{props.n}</span>
        <h2>
          {props.title}
          <em>{props.note}</em>
        </h2>
        <p>{props.desc}</p>
      </div>
      <div class={`ink-pane ${props.class}`}>
        {props.children}
        <div class="ink-hero">
          <h3>What's on your mind?</h3>
          <div class="ink-composer">Message Yuki</div>
        </div>
      </div>
    </section>
  )
}

// ----- 1. Living ink ------------------------------------------------------------------------

const BW = 1180
const BH = 380

/** A brush path through points, smoothed with quadratic joins. */
function through(pts: readonly (readonly [number, number])[]): string {
  let d = `M${pts[0]![0].toFixed(1)} ${pts[0]![1].toFixed(1)}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i]!
    const [nx, ny] = pts[i + 1]!
    d += ` Q${x.toFixed(1)} ${y.toFixed(1)} ${((x + nx) / 2).toFixed(1)} ${((y + ny) / 2).toFixed(1)}`
  }
  const [lx, ly] = pts[pts.length - 1]!
  return `${d} L${lx.toFixed(1)} ${ly.toFixed(1)}`
}

/** An ensō: one breath of the brush, most of a circle, the end lifting off a little wide. */
function enso(cx: number, cy: number, r: number): string {
  const a0 = rand(-2.2, -1.6)
  const pts: [number, number][] = []
  for (let i = 0; i <= 48; i++) {
    const p = i / 48
    const a = a0 + p * Math.PI * 1.86
    const rr = r * (1 + Math.sin(p * 5) * 0.025 + p * 0.06)
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.96])
  }
  return through(pts)
}

/** A stroke the brush lays down: where, how thick, and when, in seconds from the start. */
type Stroke = { d: string; w: number; at: number; dur: number; dry?: boolean }
/** A bird it paints: its feet at (x, y), its height, and when it is painted in. */
type InkBird = { x: number; y: number; size: number; shape: BirdShape; flip?: boolean; at: number; sleepy?: boolean }
type Drawing = { strokes: Stroke[]; birds: InkBird[]; kanji?: { x: number; y: number; size: number; at: number } }

/** The drawings the brush moves through, one after another. Each is a fresh, slightly different take. */
const DRAWINGS: (() => Drawing)[] = [
  // An ensō with a bird sitting in it, and two friends on a stroke of ground watching.
  () => {
    const cx = BW * 0.64
    const cy = 186
    return {
      strokes: [
        { d: enso(cx, cy, 128), w: 15, at: 0.2, dur: 2.2 },
        { d: through([[cx - 70, cy + 96], [cx, cy + 102], [cx + 76, cy + 95]]), w: 5, at: 2.5, dur: 0.6, dry: true },
        { d: through([[BW * 0.16, 308], [BW * 0.26, 300], [BW * 0.37, 306], [BW * 0.44, 302]]), w: 7, at: 3.1, dur: 1.1, dry: true },
      ],
      birds: [
        { x: cx, y: cy + 100, size: 118, shape: "mochi", at: 3.6 },
        { x: BW * 0.27, y: 303, size: 66, shape: "mochi", flip: true, at: 4.6 },
        { x: BW * 0.34, y: 305, size: 58, shape: "mochi", at: 5.2, sleepy: true },
      ],
    }
  },
  // A long branch, and five birds huddled along it in a row, the way they keep warm.
  () => {
    const y = 262
    return {
      strokes: [
        { d: through([[BW * 0.04, y + 34], [BW * 0.3, y + 6], [BW * 0.56, y - 2], [BW * 0.8, y - 18], [BW * 0.97, y - 44]]), w: 13, at: 0.2, dur: 2 },
        { d: through([[BW * 0.72, y - 12], [BW * 0.78, y - 62], [BW * 0.8, y - 96]]), w: 6, at: 1.9, dur: 0.7, dry: true },
        { d: through([[BW * 0.2, y + 16], [BW * 0.17, y - 30], [BW * 0.12, y - 58]]), w: 5, at: 2.3, dur: 0.6, dry: true },
      ],
      birds: [0, 1, 2, 3, 4].map((i) => ({
        x: BW * 0.4 + i * 66,
        y: y - 4 - i * 3.2,
        size: 82 - Math.abs(i - 2) * 4,
        shape: "mochi" as const,
        flip: i < 2,
        at: 2.8 + i * 0.55,
        sleepy: i === 2,
      })),
    }
  },
  // 雪, snow, written large and pale, with one bird napping on it and one looking up at it.
  () => ({
    strokes: [{ d: through([[BW * 0.12, 318], [BW * 0.3, 312], [BW * 0.46, 318]]), w: 6, at: 2.4, dur: 0.9, dry: true }],
    kanji: { x: BW * 0.66, y: 330, size: 300, at: 0.2 },
    birds: [
      { x: BW * 0.66 + 4, y: 74, size: 46, shape: "loaf", at: 3, sleepy: true },
      { x: BW * 0.32, y: 316, size: 92, shape: "mochi", at: 3.6 },
    ],
  }),
]

/** How long each drawing lives, and how long it takes to dry and fade. */
const HOLD = 19
const DRY = 2.6

/** A scribble that covers a box, the way a brush fills a shape in a few quick passes. */
function scribble(x: number, y: number, w: number, h: number): string {
  const pts: [number, number][] = []
  for (let i = 0; i <= 5; i++) {
    pts.push([x - w * 0.1, y + (i / 5) * h])
    pts.push([x + w * 1.1, y + ((i + 0.55) / 5) * h])
  }
  return pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ")
}

let maskId = 0

/** The drawing's markup: each stroke and bird under a mask the brush reveals. */
function markup(d: Drawing): string {
  const parts: string[] = []
  const reveal = (path: string, w: number, at: number, dur: number) => {
    const id = `inkm${maskId++}`
    parts.push(
      `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${BW}" height="${BH}"><path class="ink-reveal" data-at="${at}" data-dur="${dur}" d="${path}" pathLength="1" stroke="#fff" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/></mask>`,
    )
    return id
  }
  for (const s of d.strokes) {
    const id = reveal(s.d, s.w * 3.2, s.at, s.dur)
    parts.push(
      `<g mask="url(#${id})" filter="url(#ink-brush)" stroke="currentColor" fill="none" stroke-linecap="round">` +
        `<path d="${s.d}" stroke-width="${s.w}" stroke-opacity="${s.dry ? 0.78 : 0.94}"/>` +
        `<path d="${s.d}" stroke-width="${s.w * 0.55}" stroke-opacity=".5" stroke-dasharray="${s.dry ? "14 9 30 6" : "60 4 22 3"}" transform="translate(0 ${s.w * 0.28})"/>` +
        `</g>`,
    )
  }
  if (d.kanji) {
    const k = d.kanji
    const id = reveal(scribble(k.x - k.size * 0.52, k.y - k.size * 0.92, k.size * 1.04, k.size), k.size * 0.3, k.at, 2.4)
    parts.push(`<text mask="url(#${id})" filter="url(#ink-brush)" x="${k.x}" y="${k.y}" font-size="${k.size}" text-anchor="middle" class="ink-kanji">雪</text>`)
  }
  for (const b of d.birds) {
    const [vx, vy, vw, vh] = VIEWBOX[b.shape]
    const w = (b.size * vw) / vh
    const top = b.y - ((101 - vy) / vh) * b.size
    const left = b.x - w / 2
    const id = reveal(scribble(left, top, w, b.size), b.size * 0.42, b.at, 0.9)
    const flip = b.flip ? ` transform="translate(${b.x * 2} 0) scale(-1 1)"` : ""
    parts.push(
      `<g mask="url(#${id})"${flip}><svg class="bird ink-bird" data-shape="${b.shape}" data-expressive=""${b.sleepy ? ` data-face="closed" data-sleepy=""` : ""} x="${left}" y="${top}" width="${w}" height="${b.size}" viewBox="${vx} ${vy} ${vw} ${vh}" overflow="visible">${birdSvg(YUKI_BIRD, "idle", { shape: b.shape, size: b.size, expressive: true })}</svg></g>`,
    )
  }
  // The artist's seal, pressed last.
  const last = Math.max(...d.strokes.map((s) => s.at + s.dur), ...d.birds.map((b) => b.at + 0.9))
  parts.push(
    `<g class="ink-seal" data-at="${last + 0.5}" transform="translate(${BW - 92} ${BH - 118})"><rect width="30" height="44" rx="4" fill="#c4553f"/><text x="15" y="19" text-anchor="middle" font-size="14" fill="#fbf3ea">ゆ</text><text x="15" y="36" text-anchor="middle" font-size="14" fill="#fbf3ea">き</text></g>`,
  )
  return parts.join("")
}

function LivingInk() {
  let canvas!: HTMLCanvasElement
  let layer!: SVGGElement
  let index = -1
  let start = 0
  let reveals: SVGPathElement[] = []
  let seal: SVGGElement | null = null
  let birds: SVGSVGElement[] = []
  let next: number[] = []

  const draw = (t: number) => {
    index = (index + 1) % DRAWINGS.length
    layer.innerHTML = markup(DRAWINGS[index]!())
    reveals = [...layer.querySelectorAll<SVGPathElement>(".ink-reveal")]
    seal = layer.querySelector(".ink-seal")
    birds = [...layer.querySelectorAll<SVGSVGElement>(".ink-bird")]
    next = birds.map(() => rand(1, 3))
    for (const r of reveals) {
      r.style.strokeDasharray = "1 2"
      r.style.strokeDashoffset = "1"
    }
    start = t
  }

  /** Once painted, the birds live: a blink, a glance, a lean, a happy squint, a doze. */
  const live = (b: SVGSVGElement) => {
    const set = (k: string, v: string) => b.style.setProperty(k, v)
    if (b.dataset.sleepy !== undefined) {
      set("--tilt", `${rand(-4, 4).toFixed(1)}deg`)
      return
    }
    const roll = Math.random()
    if (roll < 0.35) {
      b.dataset.face = "closed"
      setTimeout(() => b.dataset.face === "closed" && delete b.dataset.face, 150)
    } else if (roll < 0.7) {
      set("--look-x", `${rand(-2.2, 2.2).toFixed(1)}px`)
      set("--look-y", `${rand(-1.6, 1.2).toFixed(1)}px`)
    } else if (roll < 0.88) {
      set("--tilt", `${rand(-9, 9).toFixed(1)}deg`)
    } else {
      b.dataset.face = "happy"
      setTimeout(() => b.dataset.face === "happy" && delete b.dataset.face, 1300)
    }
  }

  onMount(() => {
    const stop = startSnow(canvas, { density: 0.9, sizes: [0.8, 2.6], speed: 0.7, alpha: [0.2, 0.7], bokeh: 0.04 })
    onCleanup(stop)
    if (reduced) {
      draw(0)
      for (const r of reveals) r.style.strokeDashoffset = "0"
      if (seal) seal.style.opacity = "1"
    }
  })

  loop((now, dt) => {
    const t = now / 1000
    if (index < 0 || t - start > HOLD + DRY) draw(t)
    const k = t - start
    for (const r of reveals) r.style.strokeDashoffset = String(1 - ease((k - Number(r.dataset.at)) / Number(r.dataset.dur)))
    if (seal) seal.style.opacity = String(clamp((k - Number(seal.dataset.at)) / 0.25))
    // The ink dries: it pales and softens, then the paper is fresh for the next drawing.
    const dry = clamp((k - HOLD) / DRY)
    layer.style.opacity = String(1 - smooth(dry))
    layer.style.filter = dry > 0 ? `blur(${(dry * 3).toFixed(2)}px)` : ""
    birds.forEach((b, i) => {
      if (k < 6.5 || k > HOLD) return
      if ((next[i]! -= dt) <= 0) {
        live(b)
        next[i] = rand(1.4, 4)
      }
    })
  })

  return (
    <>
      <canvas ref={canvas} class="ink-snow" />
      <svg class="ink-band" viewBox={`0 0 ${BW} ${BH}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <filter id="ink-brush" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="4" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="7" result="d" />
            <feTurbulence type="fractalNoise" baseFrequency="0.45" numOctaves="1" seed="9" result="g" />
            <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.7 1.45" result="grain" />
            <feComposite in="d" in2="grain" operator="in" />
          </filter>
          <filter id="ink-wash" x="-30%" y="-30%" width="160%" height="160%">
            <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="2" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="60" result="d" />
            <feGaussianBlur in="d" stdDeviation="16" />
          </filter>
        </defs>
        <g class="ink-wash" filter="url(#ink-wash)" fill="currentColor">
          <ellipse cx={BW * 0.7} cy={150} rx={300} ry={110} />
          <ellipse cx={BW * 0.22} cy={250} rx={240} ry={70} />
        </g>
        <g ref={layer} class="ink-layer" />
      </svg>
    </>
  )
}

// ----- 2. Snow that settles -----------------------------------------------------------------

const COL = 4
type Flake = { x: number; y: number; r: number; vy: number; ph: number; front: boolean }
type Puff = { x: number; y: number; vx: number; vy: number; r: number; life: number }

function Settle() {
  let pane!: HTMLDivElement
  let back!: HTMLCanvasElement
  let front!: HTMLCanvasElement
  /** Over the bird: the snow it sits in, its cap, and the puffs. */
  let over!: HTMLCanvasElement
  let sitter!: HTMLSpanElement
  let flyer!: HTMLSpanElement
  const S = 96
  const FH = 46
  const FW = (FH * VIEWBOX.loaf[2]) / VIEWBOX.loaf[3]

  onMount(() => {
    const bx = back.getContext("2d")!
    const fx = front.getContext("2d")!
    const ox = over.getContext("2d")!
    const dark = mode === "dark"
    let W = 0
    let H = 0
    let h = new Float32Array(0)
    let flakes: Flake[] = []
    let puffs: Puff[] = []
    let gust = 0
    let clock = 0
    // The bird's visit, as a little timeline it loops through.
    let visit = { at: 0, x: 0, from: -1, sink: 0, cap: 0, landed: false, gy: 0 }

    const size = () => {
      const dpr = Math.min(2, devicePixelRatio || 1)
      W = pane.clientWidth
      H = pane.clientHeight
      for (const [c, g] of [[back, bx], [front, fx], [over, ox]] as const) {
        c.width = Math.round(W * dpr)
        c.height = Math.round(H * dpr)
        g.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
      h = new Float32Array(Math.ceil(W / COL) + 1).map((_, i) => 54 + Math.sin(i * 0.05) * 10 + Math.sin(i * 0.013 + 1) * 16)
      flakes = Array.from({ length: Math.round((W * H) / 3600) }, () => spawn(Math.random() * H))
    }
    const spawn = (y = -6): Flake => ({ x: Math.random() * W, y, r: rand(0.9, 3.2), vy: rand(30, 62), ph: Math.random() * 6, front: Math.random() < 0.3 })
    const ground = (x: number) => H - (h[clamp(Math.round(x / COL), 0, h.length - 1)] ?? 0)
    const deposit = (x: number, amount: number) => {
      const c = Math.round(x / COL)
      for (let k = -5; k <= 5; k++) if (h[c + k] !== undefined) h[c + k]! += amount * Math.exp(-(k * k) / 8)
    }
    const puff = (x: number, y: number, n: number, spread: number, wind = 0) => {
      for (let i = 0; i < n; i++) puffs.push({ x: x + rand(-spread, spread), y: y + rand(-6, 6), vx: rand(-60, 60) + wind, vy: rand(-110, -30), r: rand(1.2, 3.4), life: rand(0.7, 1.4) })
    }

    const snow = (g: CanvasRenderingContext2D, f: Flake) => {
      g.globalAlpha = 0.35 + f.r / 5
      g.beginPath()
      g.arc(f.x, f.y, f.r, 0, Math.PI * 2)
      g.fill()
    }

    const paint = () => {
      bx.clearRect(0, 0, W, H)
      fx.clearRect(0, 0, W, H)
      bx.fillStyle = fx.fillStyle = dark ? "#e8eef6" : "#ffffff"
      for (const f of flakes) snow(f.front ? fx : bx, f)
      fx.globalAlpha = 1
      // The drift: a smooth surface, bright at its lip and cooler where it is deep.
      fx.beginPath()
      fx.moveTo(0, H)
      for (let i = 0; i < h.length; i++) fx.lineTo(i * COL, H - h[i]!)
      fx.lineTo(W, H)
      fx.closePath()
      const top = H - Math.max(...h)
      const grad = fx.createLinearGradient(0, top, 0, H)
      grad.addColorStop(0, dark ? "#d6deea" : "#ffffff")
      grad.addColorStop(0.35, dark ? "#aab6c8" : "#f1f4f8")
      grad.addColorStop(1, dark ? "#6f7b90" : "#dde4ee")
      fx.fillStyle = grad
      fx.shadowColor = dark ? "rgba(0,0,0,.35)" : "rgba(90,110,140,.18)"
      fx.shadowBlur = 18
      fx.shadowOffsetY = -2
      fx.fill()
      fx.shadowBlur = 0
      fx.shadowOffsetY = 0
      fx.strokeStyle = dark ? "rgba(255,255,255,.5)" : "rgba(255,255,255,.95)"
      fx.lineWidth = 1.5
      fx.stroke()
      ox.clearRect(0, 0, W, H)
      const snowTop = dark ? "#d6deea" : "#ffffff"
      // The snow the bird has settled into: a soft mound around its belly, in front of it.
      if (sitter.style.opacity === "1") {
        const sunk = visit.sink / (S * 0.12)
        const g = ox.createRadialGradient(visit.x, visit.gy + 6, 2, visit.x, visit.gy + 6, S * 0.5)
        g.addColorStop(0, snowTop)
        g.addColorStop(0.75, snowTop)
        g.addColorStop(1, dark ? "rgba(214,222,234,0)" : "rgba(255,255,255,0)")
        ox.fillStyle = g
        ox.beginPath()
        ox.ellipse(visit.x, visit.gy + 6, S * (0.34 + sunk * 0.06), 4 + sunk * 4, 0, 0, Math.PI * 2)
        ox.fill()
      }
      // The snow settling on the bird's head while it sits.
      if (visit.cap > 0.02) {
        const r = sitter.getBoundingClientRect()
        const p = pane.getBoundingClientRect()
        const cx = r.left - p.left + r.width / 2
        const cy = r.top - p.top + r.height * 0.27
        ox.fillStyle = dark ? "#e3e9f2" : "#ffffff"
        ox.beginPath()
        ox.ellipse(cx, cy, S * 0.12 + visit.cap * S * 0.16, 2 + visit.cap * 5, 0, Math.PI, 0)
        ox.fill()
      }
      ox.fillStyle = dark ? "#e8eef6" : "#ffffff"
      for (const pf of puffs) {
        ox.globalAlpha = clamp(pf.life)
        ox.beginPath()
        ox.arc(pf.x, pf.y, pf.r, 0, Math.PI * 2)
        ox.fill()
      }
      ox.globalAlpha = 1
    }

    const place = (el: HTMLElement, x: number, y: number, rot = 0, flip = false) => {
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scaleX(${flip ? -1 : 1})`
    }
    const face = (f: string) => (f ? (sitter.dataset.face = f) : delete sitter.dataset.face)
    const look = (x: number, y: number, tilt = 0) => {
      sitter.style.setProperty("--look-x", `${x}px`)
      sitter.style.setProperty("--look-y", `${y}px`)
      sitter.style.setProperty("--tilt", `${tilt}deg`)
    }

    /** One visit: fly in, land, sink, doze under a cap of snow, shake it off, fly on. */
    const bird = (k: number) => {
      const X = visit.x
      // Once it has landed it stays at the height it landed at; the snow falls on it, not under it.
      const gy = visit.landed ? visit.gy : ground(X)
      const sitY = (sink: number) => gy - ((101 - VIEWBOX.mochi[1]) / VIEWBOX.mochi[3]) * S + sink
      sitter.style.opacity = flyer.style.opacity = "0"
      if (k < 1.5) return
      if (k < 4) {
        // Flying in, a bounding glide down from the upper left.
        const p = (k - 1.5) / 2.5
        const x = visit.from + (X - visit.from) * smooth(p)
        const y = H * 0.18 + (gy - FH * 0.9 - H * 0.18) * ease(p) - Math.sin(p * Math.PI * 3) * 14 * (1 - p)
        flyer.style.opacity = "1"
        place(flyer, x - FW / 2, y, -6 + p * 6, visit.from > X)
        return
      }
      if (!visit.landed) {
        visit.landed = true
        visit.gy = gy
        puff(X, gy, 10, S * 0.3)
      }
      sitter.style.opacity = "1"
      if (k < 10.5) {
        // Settling in: it sinks into the soft snow and its eyes close.
        visit.sink = S * 0.12 * smooth((k - 4.3) / 4.5)
        visit.cap = clamp((k - 6) / 4)
        face(k > 6.6 ? "closed" : "")
        look(0, 0, Math.sin(k * 0.9) * 2)
      } else if (k < 13.4) {
        // Peeking out from the drift.
        face(k > 10.8 && k < 11 ? "closed" : "")
        const side = k < 12 ? -2 : 2
        look(side, -0.6, side * 1.5)
      } else if (k < 14.2) {
        // A shake: the snow flies off its head and it pops up.
        const p = (k - 13.4) / 0.8
        look(0, 0, Math.sin(p * Math.PI * 9) * 14 * (1 - p))
        if (visit.cap > 0) {
          puff(X, sitY(visit.sink) + S * 0.25, 26, S * 0.3)
          deposit(X, -S * 0.08)
        }
        visit.cap = 0
        visit.sink = S * 0.12 * (1 - ease(p)) + S * 0.04
        face("happy")
      } else if (k < 15.4) {
        look(1.6, -1, 0)
      } else if (k < 18) {
        // And on its way, up and off to the right.
        sitter.style.opacity = "0"
        const p = (k - 15.4) / 2.6
        flyer.style.opacity = "1"
        place(flyer, X - FW / 2 + p * W * 0.7, gy - FH - Math.sin(p * Math.PI * 0.7) * H * 0.55 + Math.sin(p * 30) * 4, -8, false)
        return
      } else {
        visit = { at: clock, x: rand(W * 0.22, W * 0.78), from: Math.random() < 0.5 ? -80 : W + 80, sink: 0, cap: 0, landed: false, gy: 0 }
        face("")
        return
      }
      place(sitter, X - S / 2, sitY(visit.sink))
      // Below the snow line it is hidden, so it sinks in rather than sliding behind the drift.
      const cut = ((101 - VIEWBOX.mochi[1]) / VIEWBOX.mochi[3] - visit.sink / S) * 100 + 2
      sitter.style.maskImage = `linear-gradient(to bottom, #000 ${cut.toFixed(1)}%, transparent ${(cut + 1).toFixed(1)}%)`
    }

    size()
    visit = { at: 0, x: W * 0.68, from: -80, sink: 0, cap: 0, landed: false, gy: 0 }
    paint()
    if (reduced) return
    const ro = new ResizeObserver(size)
    ro.observe(pane)
    let raf = 0
    let last = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - (last || now)) / 1000)
      last = now
      clock += dt
      const mean = h.reduce((a, b) => a + b, 0) / h.length
      // When the drift is deep, a gust skims its top off in a spray.
      if (gust <= 0 && mean > 120) gust = 3.6
      const windX = Math.sin(clock / 6) * 10 + (gust > 0 ? 160 : 0)
      if (gust > 0) {
        gust -= dt
        for (let i = 0; i < h.length; i++) h[i] = Math.max(40, h[i]! - 22 * dt * (h[i]! / mean))
        if (Math.random() < 0.8) {
          const x = Math.random() * W
          puff(x, ground(x), 2, 4, 220)
        }
      }
      for (const f of flakes) {
        f.y += f.vy * dt
        f.x += (windX * (0.5 + f.r / 4) + Math.sin(clock * 1.3 + f.ph) * 9) * dt
        if (f.x > W + 10) f.x -= W + 20
        if (f.x < -10) f.x += W + 20
        const sitting = visit.landed && sitter.style.opacity === "1" && Math.abs(f.x - visit.x) < S * 0.42
        if (f.y >= ground(f.x) - (sitting ? S * 0.3 : 0)) {
          if (!sitting) deposit(f.x, f.r * 1.6)
          Object.assign(f, spawn())
        }
      }
      // The snow slumps a little, so the drift stays soft and smooth.
      for (let i = 1; i < h.length - 1; i++) h[i] = h[i]! + 0.1 * ((h[i - 1]! + h[i + 1]!) / 2 - h[i]!)
      puffs = puffs.filter((p) => {
        p.vy += 220 * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.life -= dt
        return p.life > 0 && p.y < ground(p.x) + 2
      })
      bird(clock - visit.at)
      paint()
    }
    raf = requestAnimationFrame(tick)
    onCleanup(() => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    })
  })

  return (
    <div ref={pane} class="ink-fill">
      <canvas ref={back} class="ink-fill" />
      <Bird slug="yuki" shape="loaf" size={FH} class="ink-actor" ref={(el) => (flyer = el)} />
      <Bird slug="yuki" size={S} alive expressive class="ink-actor" ref={(el) => (sitter = el)} />
      <canvas ref={front} class="ink-fill ink-front" />
      <canvas ref={over} class="ink-fill ink-over" />
    </div>
  )
}

// ----- 3. Ink flock -------------------------------------------------------------------------

type Boid = { x: number; y: number; vx: number; vy: number; ph: number; tx: number; ty: number; past: [number, number][] }

/** A bird drawn once to an image, so a flock of forty costs forty stamps a frame. */
function stamp(height: number): HTMLImageElement {
  const [vx, vy, vw, vh] = VIEWBOX.loaf
  const w = Math.round((height * vw) / vh)
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${w * 3}" height="${height * 3}">${birdSvg(YUKI_BIRD, "idle", { shape: "loaf", size: height })}</svg>`)}`
  return img
}

/** Shapes the flock gathers into, as points in a band `w` by `h`, in the order birds take them. */
const SHAPES: { name: string; at: (i: number, n: number, w: number, h: number) => [number, number] }[] = [
  { name: "ensō", at: (i, n, w, h) => {
    const a = -1.9 + (i / n) * Math.PI * 1.85
    const r = Math.min(w, h) * 0.34
    return [w / 2 + Math.cos(a) * r * 1.1, h * 0.5 + Math.sin(a) * r]
  } },
  { name: "wave", at: (i, n, w, h) => {
    const p = i / (n - 1)
    return [w * (0.1 + p * 0.8), h * 0.5 + Math.sin(p * Math.PI * 2.4) * h * 0.2 - Math.sin(p * Math.PI) * h * 0.08]
  } },
  { name: "skein", at: (i, n, w, h) => {
    const arm = i % 2 ? 1 : -1
    const k = Math.ceil(i / 2)
    return [w * 0.72 - k * w * 0.028, h * 0.46 + arm * k * h * 0.032]
  } },
  { name: "huddle", at: (i, n, w, h) => {
    const row = i < n / 2 ? 0 : 1
    const j = row ? i - Math.floor(n / 2) : i
    return [w * 0.5 + (j - n / 4) * 26 + row * 13, h * 0.44 + row * 20]
  } },
]

function Flock() {
  let canvas!: HTMLCanvasElement
  let trail!: HTMLCanvasElement

  onMount(() => {
    const ctx = canvas.getContext("2d")!
    const tr = trail.getContext("2d")!
    const img = stamp(24)
    const SW = (24 * VIEWBOX.loaf[2]) / VIEWBOX.loaf[3]
    let W = 0
    let H = 0
    let band = 0
    let ink = "40,36,32"
    const N = 40
    let boids: Boid[] = []
    let clock = 0
    let shape = 0
    /** Free flight, then a shape held, then free again. */
    const FREE = 8
    const FORM = 7

    const size = () => {
      const dpr = Math.min(2, devicePixelRatio || 1)
      W = canvas.clientWidth
      H = canvas.clientHeight
      band = H * 0.5
      for (const [c, g] of [[canvas, ctx], [trail, tr]] as const) {
        c.width = Math.round(W * dpr)
        c.height = Math.round(H * dpr)
        g.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
      const rgb = getComputedStyle(canvas).color.match(/\d+/g)
      if (rgb) ink = rgb.slice(0, 3).join(",")
      if (!boids.length) boids = Array.from({ length: N }, () => ({ x: rand(W * 0.2, W * 0.8), y: rand(band * 0.2, band * 0.8), vx: rand(-40, 40), vy: rand(-20, 20), ph: Math.random() * 6, tx: 0, ty: 0, past: [] }))
    }

    const assign = () => {
      const s = SHAPES[shape % SHAPES.length]!
      const pts = Array.from({ length: N }, (_, i) => s.at(i, N, W, band))
      // Birds take the points in sweep order, so nobody crosses the whole sky to reach theirs.
      const cx = W / 2
      const cy = band / 2
      const key = (b: Boid) => (s.name === "ensō" ? Math.atan2(b.y - cy, b.x - cx) : s.name === "skein" ? Math.abs(b.y - cy) : b.x)
      const order = [...boids].sort((a, b) => key(a) - key(b))
      const pkey = (p: [number, number]) => (s.name === "ensō" ? Math.atan2(p[1] - cy, p[0] - cx) : s.name === "skein" ? Math.abs(p[1] - cy) : p[0])
      const sorted = [...pts].sort((a, b) => pkey(a) - pkey(b))
      order.forEach((b, i) => ([b.tx, b.ty] = sorted[i]!))
    }

    const frame = (dt: number) => {
      clock += dt
      const cycle = clock % (FREE + FORM)
      const forming = cycle > FREE
      if (forming && cycle - dt <= FREE) assign()
      if (!forming && cycle < dt) shape++
      for (const b of boids) {
        let ax = 0
        let ay = 0
        if (forming) {
          const dx = b.tx - b.x
          const dy = b.ty - b.y
          const d = Math.hypot(dx, dy) || 1
          const want = Math.min(110, d * 1.4)
          ax += ((dx / d) * want - b.vx) * 1.6
          ay += ((dy / d) * want - b.vy) * 1.6 + Math.sin(clock * 2 + b.ph) * 6
        } else {
          let cx = 0, cy = 0, avx = 0, avy = 0, sx = 0, sy = 0, n = 0
          for (const o of boids) {
            if (o === b) continue
            const dx = o.x - b.x
            const dy = o.y - b.y
            const d = Math.hypot(dx, dy)
            if (d < 110) {
              cx += o.x; cy += o.y; avx += o.vx; avy += o.vy; n++
              if (d < 30) { sx -= dx / (d || 1); sy -= dy / (d || 1) }
            }
          }
          if (n) {
            ax += (cx / n - b.x) * 0.25 + (avx / n - b.vx) * 0.6
            ay += (cy / n - b.y) * 0.25 + (avy / n - b.vy) * 0.6
          }
          ax += sx * 70
          ay += sy * 70
          // A slow curl in the air, and a soft wall around the band.
          ax += Math.cos(clock * 0.4 + b.y / 160) * 12
          ay += Math.sin(clock * 0.5 + b.x / 200) * 10
          const m = 70
          if (b.x < m) ax += (m - b.x) * 2
          if (b.x > W - m) ax -= (b.x - W + m) * 2
          if (b.y < 40) ay += (40 - b.y) * 2
          if (b.y > band - 30) ay -= (b.y - band + 30) * 2
        }
        b.vx += ax * dt
        b.vy += ay * dt
        const sp = Math.hypot(b.vx, b.vy)
        const max = forming ? 120 : 75
        const min = forming ? 0 : 32
        if (sp > max) { b.vx *= max / sp; b.vy *= max / sp }
        if (sp < min && sp > 0) { b.vx *= min / sp; b.vy *= min / sp }
        b.x += b.vx * dt
        b.y += b.vy * dt
      }
      // Each bird's wake: a short brush line behind it that thins and fades.
      tr.clearRect(0, 0, W, H)
      tr.lineCap = "round"
      for (const b of boids) {
        b.past.push([b.x - Math.sign(b.vx || 1) * SW * 0.42, b.y + 2])
        if (b.past.length > 22) b.past.shift()
        for (let i = 1; i < b.past.length; i++) {
          const k = i / b.past.length
          tr.strokeStyle = `rgba(${ink},${(k * 0.16).toFixed(3)})`
          tr.lineWidth = k * 2.4
          tr.beginPath()
          tr.moveTo(...b.past[i - 1]!)
          tr.lineTo(...b.past[i]!)
          tr.stroke()
        }
      }
      ctx.clearRect(0, 0, W, H)
      for (const b of boids) {
        const left = b.vx < 0
        const tilt = clamp(Math.atan2(b.vy, Math.abs(b.vx) + 40), -0.28, 0.28)
        const flap = 1 - Math.max(0, Math.sin(clock * 9 + b.ph)) * 0.16
        ctx.save()
        ctx.translate(b.x, b.y)
        ctx.scale(left ? -1 : 1, 1)
        ctx.rotate(tilt)
        ctx.scale(1, flap)
        ctx.drawImage(img, -SW / 2, -12, SW, 24)
        ctx.restore()
      }
    }

    size()
    const ro = new ResizeObserver(size)
    ro.observe(canvas)
    img.onload = () => frame(0)
    if (reduced) return
    let raf = 0
    let last = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      frame(Math.min(0.05, (now - (last || now)) / 1000))
      last = now
    }
    raf = requestAnimationFrame(tick)
    onCleanup(() => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    })
  })

  return (
    <>
      <canvas ref={trail} class="ink-fill ink-trail" />
      <canvas ref={canvas} class="ink-fill ink-flock" />
    </>
  )
}

function Page() {
  return (
    <main class="ink-page">
      <header>
        <h1>Three ways in ink</h1>
        <p>
          The empty chat in Yuki's own language: sumi ink and snow. All three run live, under the real heading and composer.{" "}
          <a href={mode === "dark" ? "?mode=light" : "?mode=dark"}>{mode === "dark" ? "See light" : "See dark"}</a>
        </p>
      </header>
      <Pane n="1" title="Living ink" note="my pick" class="ink-living" desc="A brush paints a small picture stroke by stroke: an ensō, a branch, 雪. The birds are inked in last, then live: they blink, glance, lean and doze. Every twenty seconds the ink dries away and the brush starts another.">
        <LivingInk />
      </Pane>
      <Pane n="2" title="Snow that settles" note="cozy" class="ink-settle" desc="Heavy, soft snow fills the pane and piles into drifts. An Enaga lands, sinks in until only its head shows, dozes under a little cap of snow, shakes it off and flies on. When the drift gets deep a gust skims it.">
        <Settle />
      </Pane>
      <Pane n="3" title="Ink flock" note="fullest" class="ink-flocking" desc="Forty small Enaga drift in a slow murmuration, leaving a faint wash of ink. Every fifteen seconds they gather into a shape, an ensō, a wave, a skein, a huddle, then scatter again.">
        <Flock />
      </Pane>
    </main>
  )
}

render(() => <Page />, document.getElementById("root")!)
