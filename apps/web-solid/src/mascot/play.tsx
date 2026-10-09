// Four playful empty chats, live: origami crane, kendama, bubbles, and a nap on a cloud. Each is the
// real bird with one small prop on a soft grainy snow-to-sky background. Open
// /src/mascot/play.html on the dev server; `?mode=dark` shows the twilight version.

import { For, onCleanup, onMount, type JSX } from "solid-js"
import { render } from "solid-js/web"
import "../styles/app.css"
import { applyCommitted } from "../theme/apply"
import { DEFAULT_LOOK } from "../theme/look"
import { Bird } from "./bird"
import { birdSvg, VIEWBOX, YUKI_BIRD } from "./birds"
import "./play.css"

const mode = new URLSearchParams(location.search).get("mode") === "dark" ? "dark" : "light"
applyCommitted({ ...DEFAULT_LOOK, mode })

/** The stage the bird plays on, in px. The bird sits centered near its bottom. */
const W = 440
const H = 210
const S = 100
const CX = W / 2
const BASE = 182
const BIRD_TOP = BASE - 0.75 * S
/** Points on the bird, from its drawing: the beak, and the tip of its right-hand nub. */
const BEAK = { x: CX + (0.553 - 0.5) * S, y: BIRD_TOP + 0.58 * S }
const NUB = { x: CX + 0.36 * S, y: BIRD_TOP + 0.6 * S }

const ease = (p: number) => 0.5 - Math.cos(Math.PI * Math.min(1, Math.max(0, p))) / 2
const lerp = (a: number, b: number, p: number) => a + (b - a) * p
const rand = (a: number, b: number) => a + Math.random() * (b - a)

type Face = "" | "happy" | "open" | "closed"
function pose(bird: HTMLSpanElement, p: { tilt?: number; x?: number; y?: number; face?: Face }) {
  bird.style.setProperty("--tilt", `${(p.tilt ?? 0).toFixed(2)}deg`)
  bird.style.setProperty("--look-x", `${(p.x ?? 0).toFixed(2)}px`)
  bird.style.setProperty("--look-y", `${(p.y ?? 0).toFixed(2)}px`)
  if (p.face) bird.dataset.face = p.face
  else delete bird.dataset.face
}

/** Runs `frame(t)` every animation frame while mounted. Nothing under reduced motion. */
function loop(frame: (t: number) => void) {
  onMount(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return
    let raf = 0
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick)
      frame(t)
    }
    raf = requestAnimationFrame(tick)
    onCleanup(() => cancelAnimationFrame(raf))
  })
}

function Stage(props: { children: JSX.Element; bird: (el: HTMLSpanElement) => void; front?: JSX.Element }) {
  return (
    <div class="play-stage" style={{ width: `${W}px`, height: `${H}px` }}>
      {props.children}
      <span class="play-bird" style={{ left: `${CX - S / 2}px`, top: `${BIRD_TOP}px` }}>
        <span class="play-shadow" />
        <Bird slug="yuki" size={S} alive expressive ref={props.bird} />
      </span>
      {props.front}
    </div>
  )
}

// ----- 1. Origami crane ------------------------------------------------------------------

/** The paper as it is folded: a square, a triangle, a kite, a crane. Local units, centred. */
const FOLDS = [
  "M-22 0 L0 -12 L22 0 L0 12Z",
  "M-24 6 L0 -14 L24 6Z",
  "M-26 4 L0 -18 L8 2 L0 10Z",
  "M-28 -10 L-8 2 L-2 -16 L4 2 L22 -4 L10 6 L-2 10Z",
]
const PAPERS = ["#f4c3cc", "#bfe0cf", "#bcd6ee", "#f6dc93"]

function Origami() {
  let bird!: HTMLSpanElement
  let paper!: SVGPathElement
  let paperG!: SVGGElement
  let crane!: SVGGElement
  let wingL!: SVGPathElement
  let wingR!: SVGPathElement
  const CYCLE = 9600
  const AT = { x: CX + 62, y: BASE - 4 }
  let start = 0
  let round = 0
  loop((t) => {
    if (!start) start = t
    const k = t - start
    if (k > CYCLE) {
      start = t
      round++
    }
    const color = PAPERS[round % PAPERS.length]!
    paper.setAttribute("fill", color)
    crane.querySelectorAll("path").forEach((p) => p.setAttribute("fill", color))
    if (k < 600) {
      // A fresh sheet slides in.
      paperG.style.opacity = String(k / 600)
      paperG.setAttribute("transform", `translate(${AT.x + (1 - ease(k / 600)) * 40} ${AT.y})`)
      paper.setAttribute("d", FOLDS[0]!)
      crane.style.opacity = "0"
      pose(bird, { x: 1.4, y: 0.6 })
      return
    }
    if (k < 5600) {
      // Four folds, each a peck and a flip of the paper.
      const f = (k - 600) / 1250
      const step = Math.min(3, Math.floor(f))
      const p = f - step
      paper.setAttribute("d", FOLDS[step]!)
      paperG.setAttribute("transform", `translate(${AT.x} ${AT.y}) scale(1 ${p < 0.25 ? 1 - Math.sin((p / 0.25) * Math.PI) * 0.8 : 1})`)
      pose(bird, { tilt: Math.max(0, Math.sin(p * Math.PI * 2)) * 14, x: 1.6, y: 1.2, face: p > 0.6 && step === 3 ? "happy" : "" })
      return
    }
    if (k < 6400) {
      // The crane comes to life.
      paperG.style.opacity = "0"
      crane.style.opacity = "1"
      crane.setAttribute("transform", `translate(${AT.x} ${AT.y - 6})`)
      const flap = Math.sin(k / 70) * 30
      wingL.setAttribute("transform", `rotate(${-flap})`)
      wingR.setAttribute("transform", `rotate(${flap})`)
      pose(bird, { x: 1.6, y: 0, face: "happy" })
      return
    }
    if (k < 8800) {
      // And flies off, up and away to the right; the bird watches it go.
      const p = (k - 6400) / 2400
      const x = AT.x + p * 260
      const y = AT.y - 6 - Math.sin(p * Math.PI * 0.9) * 150 - p * 60
      crane.setAttribute("transform", `translate(${x} ${y}) rotate(${-14 + Math.sin(p * 12) * 6}) scale(${1 - p * 0.3})`)
      crane.style.opacity = String(1 - Math.max(0, p - 0.7) / 0.3)
      const flap = Math.sin(k / 60) * 34
      wingL.setAttribute("transform", `rotate(${-flap})`)
      wingR.setAttribute("transform", `rotate(${flap})`)
      pose(bird, { tilt: -3, x: 1.8, y: -2.2, face: p > 0.5 ? "happy" : "" })
      return
    }
    crane.style.opacity = "0"
    pose(bird, { x: 0, y: 0, face: "happy" })
  })
  return (
    <Stage
      bird={(el) => (bird = el)}
      front={
        <svg class="play-svg" viewBox={`0 0 ${W} ${H}`}>
          <g ref={paperG} class="play-ink">
            <path ref={paper} />
          </g>
          <g ref={crane} class="play-ink" style={{ opacity: 0 }}>
            <path d="M-26 -2 L-6 2 L-2 -6 L4 2 L22 -6 L10 6 L-4 8Z" />
            <path ref={wingL} d="M-4 0 L-14 -20 L4 -2Z" />
            <path ref={wingR} d="M0 0 L16 -20 L6 -1Z" />
          </g>
        </svg>
      }
    >
      <span />
    </Stage>
  )
}

// ----- 2. Kendama ------------------------------------------------------------------------

function Kendama() {
  let bird!: HTMLSpanElement
  let ball!: SVGCircleElement
  let ballShine!: SVGCircleElement
  let string!: SVGPathElement
  let ken!: SVGGElement
  let spark!: SVGGElement
  // The ken is held under the right nub; the cup's rim is at the top, the string ties below it.
  const CUP = { x: NUB.x + 6, y: NUB.y - 44 }
  const TIE = { x: NUB.x + 6, y: NUB.y - 30 }
  const L = 46
  let phase: "swing" | "toss" | "land" | "miss" = "swing"
  let at = 0
  let landed = false
  let tries = 0
  let pos = { x: TIE.x, y: TIE.y + L }
  loop((t) => {
    if (!at) at = t
    const k = t - at
    let tilt = 0
    let face: Face = ""
    let lookY = -0.6
    if (phase === "swing") {
      // A pendulum swing to build up, the ball hanging from the tie.
      const a = Math.sin(k / 280) * Math.min(0.9, k / 1600)
      pos = { x: TIE.x + Math.sin(a) * L, y: TIE.y + Math.cos(a) * L }
      tilt = Math.sin(k / 280) * 4
      lookY = 1.2
      if (k > 2200 && Math.abs(Math.sin(k / 280)) < 0.08) ((phase = "toss"), (at = t), (landed = Math.random() < 0.6 || tries >= 2))
    } else if (phase === "toss") {
      // A flick: the ball arcs up and comes down on the cup, or just past it.
      const p = Math.min(1, k / 620)
      const endX = landed ? CUP.x : CUP.x + 14
      pos = { x: lerp(TIE.x, endX, p), y: lerp(TIE.y + L, CUP.y - 8, p) - Math.sin(p * Math.PI) * 70 }
      tilt = 8 * Math.sin(p * Math.PI)
      lookY = -2
      if (p >= 1) ((phase = landed ? "land" : "miss"), (at = t))
    } else if (phase === "land") {
      pos = { x: CUP.x, y: CUP.y - 8 }
      face = "happy"
      tilt = Math.sin(k / 160) * 3
      spark.style.opacity = String(Math.max(0, 1 - k / 700))
      spark.setAttribute("transform", `translate(${CUP.x} ${CUP.y - 14}) scale(${1 + k / 700})`)
      if (k > 2200) ((phase = "swing"), (at = t), (tries = 0))
    } else {
      // A miss: it bounces off the rim and swings back down; the bird winces and tries again.
      const p = Math.min(1, k / 700)
      pos = { x: lerp(CUP.x + 14, TIE.x + 20, p), y: lerp(CUP.y - 8, TIE.y + L - 4, ease(p)) - Math.sin(p * Math.PI) * 18 }
      face = p < 0.6 ? "open" : ""
      if (k > 1100) ((phase = "swing"), (at = t), tries++)
    }
    ball.setAttribute("cx", pos.x.toFixed(1))
    ball.setAttribute("cy", pos.y.toFixed(1))
    ballShine.setAttribute("cx", (pos.x - 2.4).toFixed(1))
    ballShine.setAttribute("cy", (pos.y - 2.6).toFixed(1))
    const sag = Math.max(0, L - Math.hypot(pos.x - TIE.x, pos.y - TIE.y))
    string.setAttribute("d", `M${TIE.x} ${TIE.y} Q${(TIE.x + pos.x) / 2 + sag * 0.3} ${(TIE.y + pos.y) / 2 + sag * 0.6} ${pos.x} ${pos.y}`)
    ken.setAttribute("transform", `rotate(${(tilt * 0.6).toFixed(1)} ${NUB.x} ${NUB.y})`)
    pose(bird, { tilt, x: 1.2, y: lookY, face })
  })
  return (
    <Stage
      bird={(el) => (bird = el)}
      front={
        <svg class="play-svg" viewBox={`0 0 ${W} ${H}`}>
          <path ref={string} class="play-string" />
          <g ref={ken} class="play-ink">
            <rect x={NUB.x + 3} y={NUB.y - 40} width="6" height="46" rx="2.5" fill="#c99a6a" />
            <path d={`M${CUP.x - 9} ${CUP.y - 2} Q${CUP.x} ${CUP.y + 8} ${CUP.x + 9} ${CUP.y - 2} L${CUP.x + 6} ${CUP.y + 6} H${CUP.x - 6}Z`} fill="#d8b085" />
            <rect x={NUB.x - 4} y={NUB.y - 34} width="20" height="7" rx="3.5" fill="#d8b085" />
          </g>
          <circle ref={ball} r="8.5" class="play-ink" fill="#e2574c" />
          <circle ref={ballShine} r="2.4" fill="#ffffff" opacity=".7" />
          <g ref={spark} style={{ opacity: 0 }} class="play-spark">
            <For each={[0, 60, 120, 180, 240, 300]}>{(a) => <path d="M0 -10 V-16" transform={`rotate(${a})`} />}</For>
          </g>
        </svg>
      }
    >
      <span />
    </Stage>
  )
}

// ----- 3. Bubbles -------------------------------------------------------------------------

type Bubble = { el: HTMLSpanElement; x: number; y: number; r: number; vx: number; vy: number; born: number; life: number; phase: number }

function Bubbles() {
  let bird!: HTMLSpanElement
  let pane!: HTMLDivElement
  let wand!: HTMLSpanElement
  let bubbles: Bubble[] = []
  let next = 600
  let start = 0
  let blowing = 0
  loop((t) => {
    if (!start) start = t
    const k = t - start
    const box = pane.getBoundingClientRect()
    const w = wand.getBoundingClientRect()
    const ring = { x: w.left - box.left + w.width / 2, y: w.top - box.top + 6 }
    if (k > next) {
      // A breath: cheeks in, then a bubble grows on the ring and floats free.
      blowing = t
      next = k + rand(900, 2200)
      const el = document.createElement("span")
      el.className = "play-bubble"
      pane.append(el)
      bubbles.push({ el, x: ring.x, y: ring.y, r: rand(9, 22), vx: rand(-14, 22), vy: rand(-34, -20), born: t, life: rand(3200, 6400), phase: rand(0, 6) })
    }
    const breath = t - blowing
    pose(bird, { tilt: 4, x: 1.4, y: -1, face: breath < 260 ? "closed" : breath < 600 ? "open" : "" })
    bird.style.setProperty("--tilt", breath < 600 ? "6deg" : "3deg")
    for (const b of bubbles) {
      const age = t - b.born
      const grow = Math.min(1, age / 500)
      if (age > 500) {
        b.x += (b.vx + Math.sin(t / 900 + b.phase) * 10) / 60
        b.y += b.vy / 60
      }
      const wob = 1 + Math.sin(t / 180 + b.phase) * 0.05
      const r = b.r * grow
      b.el.style.width = b.el.style.height = `${(r * 2).toFixed(1)}px`
      b.el.style.translate = `${(b.x - r).toFixed(1)}px ${(b.y - r).toFixed(1)}px`
      b.el.style.scale = `${wob} ${2 - wob}`
      if (age > b.life || b.y < -40) {
        // Pop: the bubble goes, leaving a ring of sparkles.
        const pop = document.createElement("span")
        pop.className = "play-pop"
        pop.style.translate = `${b.x}px ${b.y}px`
        pane.append(pop)
        pop.addEventListener("animationend", () => pop.remove())
        b.el.remove()
        b.life = -1
      }
    }
    bubbles = bubbles.filter((b) => b.life > 0)
  })
  onCleanup(() => bubbles.forEach((b) => b.el.remove()))
  return (
    <div ref={pane} class="play-bubbles">
      <Stage
        bird={(el) => (bird = el)}
        front={
          <span ref={wand} class="play-wand" style={{ left: `${BEAK.x + 18}px`, top: `${BEAK.y - 30}px` }}>
            <svg viewBox="0 0 30 50">
              <circle cx="15" cy="10" r="8" class="play-ink" fill="none" stroke-width="2.4" />
              <path d="M15 18 V48" class="play-ink" stroke-width="3" />
            </svg>
          </span>
        }
      >
        <span />
      </Stage>
    </div>
  )
}

// ----- 4. Nap on a cloud -----------------------------------------------------------------

function Nap() {
  let bird!: HTMLSpanElement
  let cloud!: HTMLSpanElement
  let sky!: HTMLDivElement
  let next = 400
  let start = 0
  loop((t) => {
    if (!start) start = t
    const k = t - start
    const bob = Math.sin(k / 1400) * 5
    cloud.style.translate = `0 ${bob.toFixed(1)}px`
    bird.parentElement!.style.translate = `0 ${bob.toFixed(1)}px`
    pose(bird, { tilt: Math.sin(k / 2600) * 3, face: "closed", y: 0.6 })
    if (k > next) {
      next = k + 1700
      // A z rises from the sleeper and turns into a tiny bird that flutters away.
      const z = document.createElement("span")
      z.className = "play-z"
      z.innerHTML = `<b>z</b><i><svg viewBox="${VIEWBOX.loaf.join(" ")}">${birdSvg(YUKI_BIRD, "idle", { shape: "loaf", flat: true, size: 14 })}</svg></i>`
      z.style.left = `${CX + 30}px`
      z.style.top = `${BIRD_TOP + 20 + bob}px`
      z.style.setProperty("--drift", `${rand(30, 80)}px`)
      sky.append(z)
      z.addEventListener("animationend", () => z.remove())
    }
  })
  return (
    <div ref={sky} class="play-sky">
      <div class="play-stage" style={{ width: `${W}px`, height: `${H}px` }}>
        <span ref={cloud} class="play-cloud">
          <svg viewBox="0 0 220 90">
            <path class="play-cloud-body" d="M28 70 C8 70 6 46 26 44 C24 24 50 16 64 30 C70 8 108 6 116 28 C128 14 160 18 160 40 C182 34 202 50 192 68 C190 76 182 78 172 78 L40 78 C32 78 28 74 28 70Z" />
            <path class="play-cloud-shade" d="M40 74 C80 80 150 80 182 72" />
          </svg>
        </span>
        <span class="play-bird" style={{ left: `${CX - S / 2}px`, top: `${BIRD_TOP - 30}px` }}>
          <Bird slug="yuki" size={S} alive state="sleeping" expressive ref={(el) => (bird = el)} />
        </span>
      </div>
    </div>
  )
}

// ----- the page ---------------------------------------------------------------------

const OPTIONS: { n: number; name: string; jp: string; what: string; scene: () => JSX.Element }[] = [
  { n: 9, name: "Origami crane", jp: "折り鶴", what: "Folds a paper crane step by step; the crane comes to life and flutters away. A new colour each time.", scene: Origami },
  { n: 24, name: "Kendama", jp: "けん玉", what: "Swings, flicks, and lands the ball on the cup, or misses, winces, and tries again.", scene: Kendama },
  { n: 26, name: "Bubbles", jp: "シャボン玉", what: "Blows bubbles that wobble up across the whole pane and pop into a ring of sparkles.", scene: Bubbles },
  { n: 31, name: "Nap on a cloud", jp: "雲のお昼寝", what: "Dozes on a drifting cloud; each z turns into a tiny bird and flutters off. For late at night.", scene: Nap },
]

function Page() {
  return (
    <main class="play-page">
      <header>
        <h1>Four ways to play</h1>
        <p>
          The real bird, live, each with one small prop on a soft grainy snow-to-sky background.{" "}
          <a href={mode === "dark" ? "?mode=light" : "?mode=dark"}>{mode === "dark" ? "Light mode" : "Dark mode"}</a>
        </p>
      </header>
      <For each={OPTIONS}>
        {(o) => (
          <section>
            <div class="play-label">
              <span>#{o.n}</span>
              <h2>
                {o.name} <em>{o.jp}</em>
              </h2>
              <p>{o.what}</p>
            </div>
            <div class="play-pane">
              <svg class="play-grain" aria-hidden="true">
                <filter id={`grain-${o.n}`}>
                  <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch" />
                  <feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.55  0 0 0 0.55 0" />
                </filter>
                <rect width="100%" height="100%" filter={`url(#grain-${o.n})`} />
              </svg>
              <div class="play-hero">
                <o.scene />
                <h3>What's on your mind?</h3>
                <div class="play-composer">Message Yuki</div>
              </div>
            </div>
          </section>
        )}
      </For>
    </main>
  )
}

render(() => <Page />, document.getElementById("root")!)
