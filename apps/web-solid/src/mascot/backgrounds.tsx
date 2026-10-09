// Four backgrounds for the empty chat that are not places: a texture or a light behind the same
// bird, heading and composer. Open /src/mascot/backgrounds.html on the dev server;
// `?mode=light` shows the light theme.

import { For, onCleanup, onMount, type JSX } from "solid-js"
import { render } from "solid-js/web"
import "../styles/app.css"
import { applyCommitted } from "../theme/apply"
import { DEFAULT_LOOK } from "../theme/look"
import { Peck } from "./peck"
import { startSnow } from "./snow"
import "./backgrounds.css"

const mode = new URLSearchParams(location.search).get("mode") === "light" ? "light" : "dark"
applyCommitted({ ...DEFAULT_LOOK, mode })
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches

/** The same hero on every background: the chat's birds foraging, the heading, the composer. */
function Hero(props: { faces?: readonly string[] }) {
  return (
    <div class="bg-hero">
      <Peck faces={props.faces ?? ["yuki"]} />
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

// ----- 3. Washi and petals: paper fibres, and sakura petals on a breeze ---------------------

type Petal = { x: number; y: number; s: number; spin: number; phase: number; v: number }

function Petals(props: { count?: number }) {
  const petals: Petal[] = Array.from({ length: props.count ?? 26 }, () => ({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 0.8, spin: Math.random() * 6, phase: Math.random() * 6, v: 0.6 + Math.random() * 0.6 }))
  return <PetalCanvas petals={petals} />
}

function Washi() {
  return (
    <>
      <svg class="bg-fill washi" aria-hidden="true">
        <filter id="fibres">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.08" numOctaves="3" seed="7" />
          <feColorMatrix values="0 0 0 0 0.6  0 0 0 0 0.55  0 0 0 0 0.5  0 0 0 0.35 0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#fibres)" />
      </svg>
      <Petals />
    </>
  )
}

function PetalCanvas(props: { petals: Petal[] }) {
  const petals = props.petals = Array.from({ length: 26 }, () => ({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 0.8, spin: Math.random() * 6, phase: Math.random() * 6, v: 0.6 + Math.random() * 0.6 }))
  let last = 0
  return (
    <>
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

// ----- Cozy, part two ---------------------------------------------------------------------

/** Fireflies: warm specks rising slowly, each glowing in and out on its own breath. */
function Hotaru() {
  const flies = Array.from({ length: 30 }, () => ({ x: Math.random(), y: Math.random(), p: Math.random() * 6, v: 0.4 + Math.random() * 0.8, r: 1.4 + Math.random() * 1.8 }))
  let last = 0
  return (
    <>
      <div class="bg-fill hotaru" />
      <Canvas
        draw={(ctx, w, h, t) => {
          const dt = last ? Math.min(0.05, (t - last) / 1000) : 0
          last = t
          for (const f of flies) {
            f.y -= 0.012 * f.v * dt
            f.x += Math.sin(t / 1900 + f.p) * 0.004 * dt
            if (f.y < -0.05) Object.assign(f, { y: 1.05, x: Math.random() })
            const glow = 0.25 + 0.75 * Math.max(0, Math.sin(t / 900 + f.p * 2)) ** 2
            const x = (f.x + Math.sin(t / 2600 + f.p) * 0.02) * w
            const y = f.y * h
            const g = ctx.createRadialGradient(x, y, 0, x, y, f.r * 7)
            g.addColorStop(0, `rgba(246, 226, 140, ${0.9 * glow})`)
            g.addColorStop(0.25, `rgba(240, 210, 110, ${0.35 * glow})`)
            g.addColorStop(1, "rgba(240, 210, 110, 0)")
            ctx.fillStyle = g
            ctx.beginPath()
            ctx.arc(x, y, f.r * 7, 0, Math.PI * 2)
            ctx.fill()
          }
        }}
      />
    </>
  )
}

/** A lamp below: a warm pool of light with dust motes turning slowly in it. */
function Lamplight() {
  const motes = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), p: Math.random() * 6, r: 0.5 + Math.random() * 1.3 }))
  return (
    <>
      <div class="bg-fill lamplight" />
      <Canvas
        draw={(ctx, w, h, t) => {
          for (const m of motes) {
            const x = (m.x + Math.sin(t / 5200 + m.p) * 0.03) * w
            const y = (m.y + Math.cos(t / 6100 + m.p) * 0.03) * h
            // Motes catch the light only inside the pool.
            const dx = (x - w / 2) / (w * 0.45)
            const dy = (y - h * 0.95) / (h * 0.9)
            const lit = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy))
            if (lit <= 0) continue
            ctx.globalAlpha = lit * (0.5 + 0.5 * Math.sin(t / 800 + m.p))
            ctx.fillStyle = "#f6d9a0"
            ctx.beginPath()
            ctx.arc(x, y, m.r, 0, Math.PI * 2)
            ctx.fill()
          }
          ctx.globalAlpha = 1
        }}
      />
    </>
  )
}

/** A frosted window at night: big blurred lantern lights beyond, snow in front, frost at the edges. */
function FrostedWindow() {
  let c: HTMLCanvasElement | undefined
  onMount(() => onCleanup(startSnow(c!, { density: 1.6, sizes: [0.8, 2.4], alpha: [0.35, 0.9], speed: 0.7, bokeh: 0.02 })))
  return (
    <>
      <div class="bg-fill frost-lights">
        <span style={{ left: "12%", top: "22%", background: "#f2b45c" }} />
        <span style={{ left: "70%", top: "14%", background: "#e88a6a" }} />
        <span style={{ left: "38%", top: "62%", background: "#f6cf7a" }} />
        <span style={{ left: "82%", top: "58%", background: "#9fb7d8" }} />
        <span style={{ left: "56%", top: "34%", background: "#f2b45c", width: "10%", height: "16%" }} />
        <span style={{ left: "4%", top: "70%", background: "#e8a2b3", width: "12%", height: "18%" }} />
      </div>
      <canvas ref={c} class="bg-canvas frost-snow" />
      <div class="bg-fill frost-edge" />
    </>
  )
}

/** Shoji: a faint lattice shadow, with warm light behind it brightening and dimming slowly. */
function Shoji() {
  return (
    <>
      <div class="bg-fill shoji-light" />
      <div class="bg-fill shoji-grid" />
    </>
  )
}

/** Knit: a soft knitted texture in warm tones, like a blanket over your lap. */
function Knit() {
  return (
    <>
      <svg class="bg-fill knit" aria-hidden="true">
        <defs>
          <pattern id="knit" width="14" height="16" patternUnits="userSpaceOnUse">
            <path d="M1 2 C3 8 5 12 7 14 M13 2 C11 8 9 12 7 14" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#knit)" />
      </svg>
      <div class="bg-fill knit-light" />
    </>
  )
}

function SeigaihaPetals() {
  return (
    <>
      <Seigaiha />
      <Petals count={16} />
    </>
  )
}

const OPTIONS: { jp: string; name: string; vibe: string; bg: () => JSX.Element; faces?: string[] }[] = [
  { jp: "蛍", name: "Hotaru", vibe: "Fireflies: warm specks rising slowly through the dark, each glowing in and out on its own breath.", bg: Hotaru },
  { jp: "灯", name: "Lamplight", vibe: "A lamp below the pane: a warm pool of light with dust motes turning slowly in it. Here with a group of three.", bg: Lamplight, faces: ["yuki", "matcha", "ramune"] },
  { jp: "雪窓", name: "Frosted window", vibe: "Big blurred lantern lights beyond frosted glass, snow drifting in front, frost at the edges.", bg: FrostedWindow },
  { jp: "障子", name: "Shoji", vibe: "A faint shoji lattice with warm light behind it, slowly brightening and dimming like the evening moving across paper.", bg: Shoji },
  { jp: "編み", name: "Knit", vibe: "A soft knitted texture in warm tones, like a blanket over your lap, with a gentle light on it.", bg: Knit },
  { jp: "青海波と花びら", name: "Seigaiha and petals", vibe: "The wave pattern with its drifting moonlight, and sakura petals tumbling over it.", bg: SeigaihaPetals },
  { jp: "青海波", name: "Seigaiha", vibe: "The traditional wave pattern, faint across the pane, with a slow band of moonlight drifting through it.", bg: Seigaiha },
  { jp: "和紙", name: "Washi and petals", vibe: "Washi paper fibres, and a few sakura petals tumbling down on a breeze. Snow in winter.", bg: Washi },
  { jp: "光", name: "Glow", vibe: "Large, very soft lights in indigo, sakura, kincha gold and matcha, drifting slowly behind the birds.", bg: Glow },
]

function Page() {
  return (
    <main class="bg-page">
      <header>
        <h1>The empty chat, cozy backgrounds</h1>
        <p>No scenes: a texture or a light behind the same playing birds, heading and composer. Live. <a href={mode === "light" ? "?mode=dark" : "?mode=light"}>{mode === "light" ? "Dark mode" : "Light mode"}</a></p>
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
              <Hero faces={o.faces} />
            </div>
          </section>
        )}
      </For>
    </main>
  )
}

render(() => <Page />, document.getElementById("root")!)
