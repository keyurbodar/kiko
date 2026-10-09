// Four backgrounds for the empty chat that are not places: a texture or a light behind the same
// bird, heading and composer. Open /src/mascot/backgrounds.html on the dev server;
// `?mode=light` shows the light theme.

import { For, onCleanup, onMount, type JSX } from "solid-js"
import { render } from "solid-js/web"
import "../styles/app.css"
import { applyCommitted } from "../theme/apply"
import { DEFAULT_LOOK } from "../theme/look"
import { Bird } from "./bird"
import "./backgrounds.css"

const mode = new URLSearchParams(location.search).get("mode") === "light" ? "light" : "dark"
applyCommitted({ ...DEFAULT_LOOK, mode })
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches

/** The same hero on every background: the bird, glancing about and beaming now and then. */
function Hero() {
  let bird: HTMLSpanElement | undefined
  onMount(() => {
    if (reduced()) return
    const faces = ["", "", "happy", ""]
    const looks: [number, number][] = [[0, 0], [-1.4, -1], [1.4, -0.6], [0, 0.4]]
    let i = 0
    const timer = setInterval(() => {
      i = (i + 1) % looks.length
      bird!.style.setProperty("--look-x", `${looks[i]![0]}px`)
      bird!.style.setProperty("--look-y", `${looks[i]![1]}px`)
      if (faces[i]) bird!.dataset.face = faces[i]!
      else delete bird!.dataset.face
    }, 2600)
    onCleanup(() => clearInterval(timer))
  })
  return (
    <div class="bg-hero">
      <Bird slug="yuki" size={96} alive expressive ref={(el) => (bird = el)} />
      <h2>What's on your mind?</h2>
      <div class="bg-composer">Message Yuki</div>
    </div>
  )
}

/** A canvas that fills its pane and redraws every frame with `draw`. Still under reduced motion. */
function Canvas(props: { draw: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number, ink: string) => void }) {
  let c: HTMLCanvasElement | undefined
  onMount(() => {
    const ctx = c!.getContext("2d")!
    let w = 0
    let h = 0
    const size = () => {
      const dpr = Math.min(2, devicePixelRatio || 1)
      w = c!.clientWidth
      h = c!.clientHeight
      c!.width = w * dpr
      c!.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    size()
    const ink = getComputedStyle(c!).color
    let raf = 0
    const frame = (t: number) => {
      ctx.clearRect(0, 0, w, h)
      props.draw(ctx, w, h, t, ink)
      if (!reduced()) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    const ro = new ResizeObserver(size)
    ro.observe(c!)
    onCleanup(() => (cancelAnimationFrame(raf), ro.disconnect()))
  })
  return <canvas ref={c} class="bg-canvas" />
}

// ----- 1. Seigaiha: the wave pattern, with moonlight drifting across it -----------------

function Seigaiha() {
  return (
    <>
      <svg class="bg-fill seigaiha" aria-hidden="true">
        <defs>
          <pattern id="seigaiha" width="48" height="24" patternUnits="userSpaceOnUse">
            <For each={[[0, 24], [48, 24], [24, 12], [0, 0], [48, 0]] as const}>
              {([cx, cy]) => (
                <g>
                  <For each={[22, 16, 10, 4]}>{(r) => <circle cx={cx} cy={cy} r={r} />}</For>
                </g>
              )}
            </For>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#seigaiha)" />
      </svg>
      <div class="bg-fill seigaiha-light" />
    </>
  )
}

// ----- 2. Sumi: soft ink clouds blooming and drifting ------------------------------------

const BLOOMS = [
  { x: 0.2, y: 0.3, r: 0.32, sx: 0.00007, sy: 0.00005, p: 0 },
  { x: 0.78, y: 0.24, r: 0.28, sx: 0.00005, sy: 0.00008, p: 2 },
  { x: 0.62, y: 0.78, r: 0.36, sx: 0.00006, sy: 0.00004, p: 4 },
  { x: 0.14, y: 0.82, r: 0.26, sx: 0.00008, sy: 0.00006, p: 1 },
]

function Sumi() {
  return (
    <>
      <Canvas
        draw={(ctx, w, h, t, ink) => {
          const m = Math.max(w, h)
          for (const b of BLOOMS) {
            const x = (b.x + Math.sin(t * b.sx + b.p) * 0.06) * w
            const y = (b.y + Math.cos(t * b.sy + b.p) * 0.05) * h
            const r = b.r * m * (1 + Math.sin(t * 0.0002 + b.p) * 0.08)
            const g = ctx.createRadialGradient(x, y, 0, x, y, r)
            g.addColorStop(0, ink.replace("rgb(", "rgba(").replace(")", ", 0.13)"))
            g.addColorStop(0.5, ink.replace("rgb(", "rgba(").replace(")", ", 0.05)"))
            g.addColorStop(1, ink.replace("rgb(", "rgba(").replace(")", ", 0)"))
            ctx.fillStyle = g
            ctx.fillRect(0, 0, w, h)
          }
        }}
      />
      <svg class="bg-fill paper-grain" aria-hidden="true">
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.45  0 0 0 0 0.4  0 0 0 0.6 0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
    </>
  )
}

// ----- 3. Washi and petals: paper fibres, and sakura petals on a breeze ---------------------

type Petal = { x: number; y: number; s: number; spin: number; phase: number; v: number }

function Washi() {
  const petals: Petal[] = Array.from({ length: 26 }, () => ({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 0.8, spin: Math.random() * 6, phase: Math.random() * 6, v: 0.6 + Math.random() * 0.6 }))
  let last = 0
  return (
    <>
      <svg class="bg-fill washi" aria-hidden="true">
        <filter id="fibres">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.08" numOctaves="3" seed="7" />
          <feColorMatrix values="0 0 0 0 0.6  0 0 0 0 0.55  0 0 0 0 0.5  0 0 0 0.35 0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#fibres)" />
      </svg>
      <Canvas
        draw={(ctx, w, h, t) => {
          const dt = last ? Math.min(0.05, (t - last) / 1000) : 0
          last = t
          for (const p of petals) {
            p.y += (0.025 * p.v) * dt
            p.x += (0.018 + Math.sin(t / 2200 + p.phase) * 0.012) * dt
            if (p.y > 1.05) Object.assign(p, { y: -0.05, x: Math.random() * 1.1 - 0.1 })
            if (p.x > 1.05) p.x = -0.05
            const x = p.x * w
            const y = p.y * h
            const flip = Math.cos(t / 900 + p.phase)
            ctx.save()
            ctx.translate(x, y)
            ctx.rotate(t / 2400 + p.spin)
            ctx.scale(p.s, p.s * Math.max(0.25, Math.abs(flip)))
            ctx.globalAlpha = 0.75
            ctx.fillStyle = "#f2b6c3"
            ctx.beginPath()
            ctx.moveTo(0, -6)
            ctx.bezierCurveTo(5, -4, 5, 4, 0, 6)
            ctx.bezierCurveTo(-5, 4, -5, -4, 0, -6)
            ctx.fill()
            ctx.globalAlpha = 0.5
            ctx.fillStyle = "#e48aa0"
            ctx.beginPath()
            ctx.moveTo(0, -6)
            ctx.lineTo(1.4, -4)
            ctx.lineTo(-1.4, -4)
            ctx.fill()
            ctx.restore()
          }
        }}
      />
    </>
  )
}

// ----- 4. Glow: soft lights in Japanese colours, drifting like light through shoji ----------

function Glow() {
  return (
    <div class="bg-fill glow" aria-hidden="true">
      <span class="g1" />
      <span class="g2" />
      <span class="g3" />
      <span class="g4" />
    </div>
  )
}

const OPTIONS: { jp: string; name: string; vibe: string; bg: () => JSX.Element }[] = [
  { jp: "青海波", name: "Seigaiha", vibe: "The traditional wave pattern, faint across the pane, with a slow band of moonlight drifting through it.", bg: Seigaiha },
  { jp: "墨", name: "Sumi ink wash", vibe: "Soft ink clouds blooming and drifting like ink in water, on a faint paper grain. Nearly monochrome.", bg: Sumi },
  { jp: "和紙", name: "Washi and petals", vibe: "Washi paper fibres, and a few sakura petals tumbling down on a breeze. Snow in winter.", bg: Washi },
  { jp: "光", name: "Glow", vibe: "Large, very soft lights in indigo, sakura, kincha gold and matcha, drifting slowly behind the bird.", bg: Glow },
]

function Page() {
  return (
    <main class="bg-page">
      <header>
        <h1>The empty chat, four backgrounds</h1>
        <p>No scenes: a texture or a light behind the same bird, heading and composer. Live. <a href={mode === "light" ? "?mode=dark" : "?mode=light"}>{mode === "light" ? "Dark mode" : "Light mode"}</a></p>
      </header>
      <For each={OPTIONS}>
        {(o, i) => (
          <section>
            <div class="bg-label">
              <span>{i() + 1}</span>
              <h2>
                {o.name} <em>{o.jp}</em>
              </h2>
              <p>{o.vibe}</p>
            </div>
            <div class="bg-pane">
              <o.bg />
              <Hero />
            </div>
          </section>
        )}
      </For>
    </main>
  )
}

render(() => <Page />, document.getElementById("root")!)
