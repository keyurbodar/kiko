import { onCleanup, onMount } from "solid-js"
import "./bird-grid.css"

/*
 * The empty chat's pixel field, after monocode's arcade grid: a dim board of cells with a
 * few pixel birds hopping along the ground, pecking at seeds, and saying so. It is drawn on a
 * canvas at 30 frames a second, stops while the tab is hidden or the field is off screen, and
 * holds one still frame for reduced motion. Colours are read from the theme, so the kiko bird
 * wears the accent and the board takes the text colour.
 */

const CELL = 6
const PITCH = 7
const ROWS = 22
const GROUND = 19
const FRAME_MS = 33

/* A bird facing right. c crest, b body, w belly, e eye, k beak, f feet. */
const SPRITE = [
  "....cc....",
  "...bbbb...",
  "..bbbbbb..",
  ".bbbbbebk.",
  ".bbbbbbbkk",
  ".bbbwwwbb.",
  "..bwwwwb..",
  "...bbbb...",
  "...f..f...",
]
const SPRITE_W = SPRITE[0]!.length
const SPRITE_H = SPRITE.length

const SAYINGS = ["seed acquired", "chirp", "yum", "one more", "found one", "hi"]

type Palette = { cell: string; body: string; belly: string; beak: string; eye: string }
type Bird = { x: number; dir: 1 | -1; hop: number; peck: number; rest: number; blink: number; palette: Palette }
type Seed = { x: number; life: number }
type Say = { text: string; x: number; y: number; life: number }

function readTheme(el: HTMLElement): { cell: string; birds: Palette[] } {
  const css = getComputedStyle(el)
  const text = css.getPropertyValue("--text").trim() || "oklch(0.9 0 0)"
  const accent = css.getPropertyValue("--accent").trim() || "oklch(0.75 0.1 340)"
  const cell = text
  const bird = (body: string): Palette => ({ cell, body, belly: "oklch(0.95 0.03 60)", beak: "oklch(0.78 0.15 60)", eye: "oklch(0.2 0.02 300)" })
  return { cell, birds: [bird(accent), bird("oklch(0.76 0.1 240)"), bird("oklch(0.86 0.14 95)")] }
}

export default function BirdGrid() {
  let canvas: HTMLCanvasElement | undefined
  let bubbles: HTMLDivElement | undefined

  onMount(() => {
    const el = canvas!
    const ctx = el.getContext("2d")
    if (!ctx) return
    let cols = 0
    let theme = readTheme(el)
    let birds: Bird[] = []
    let seeds: Seed[] = []
    let says: Say[] = []
    let raf = 0
    let last = 0
    let visible = true

    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const width = el.clientWidth
      cols = Math.max(24, Math.floor(width / PITCH))
      el.width = Math.round(cols * PITCH * dpr)
      el.height = Math.round(ROWS * PITCH * dpr)
      el.style.height = `${ROWS * PITCH}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (!birds.length) {
        birds = theme.birds.map((palette, i) => ({
          x: Math.floor(((i + 1) * cols) / (theme.birds.length + 1)) - SPRITE_W / 2,
          dir: i % 2 ? -1 : 1,
          hop: 0,
          peck: 0,
          rest: 20 + i * 15,
          blink: 0,
          palette,
        }))
      }
    }

    const cellAt = (x: number, y: number, color: string) => {
      ctx.fillStyle = color
      ctx.fillRect(x * PITCH, y * PITCH, CELL, CELL)
    }

    const drawBird = (b: Bird) => {
      const lift = b.hop > 0 ? Math.round(Math.sin((b.hop / 8) * Math.PI) * 2) : 0
      const dip = b.peck > 0 ? 1 : 0
      const top = GROUND - SPRITE_H + 1 - lift + dip
      const left = Math.round(b.x)
      for (let r = 0; r < SPRITE_H; r++) {
        const line = SPRITE[r]!
        for (let c = 0; c < SPRITE_W; c++) {
          const ch = line[b.dir === 1 ? c : SPRITE_W - 1 - c]!
          if (ch === ".") continue
          if (ch === "f" && (lift > 0 || dip > 0)) continue
          const color =
            ch === "w" ? b.palette.belly : ch === "k" || ch === "f" ? b.palette.beak : ch === "e" ? (b.blink > 0 ? b.palette.body : b.palette.eye) : b.palette.body
          cellAt(left + c, top + r, color)
        }
      }
    }

    const step = () => {
      if (Math.random() < 0.04 && seeds.length < 4) seeds.push({ x: 2 + Math.floor(Math.random() * (cols - 4)), life: 400 })
      seeds = seeds.filter((s) => --s.life > 0)
      for (const b of birds) {
        if (b.blink > 0) b.blink--
        else if (Math.random() < 0.01) b.blink = 4
        if (b.peck > 0) {
          b.peck--
          continue
        }
        if (b.hop > 0) {
          b.hop--
          b.x += b.dir * 0.35
        } else if (b.rest > 0) {
          b.rest--
        } else {
          const beak = b.dir === 1 ? b.x + SPRITE_W - 1 : b.x
          const seed = seeds.find((s) => Math.abs(s.x - beak) < 1.5)
          if (seed) {
            seeds = seeds.filter((s) => s !== seed)
            b.peck = 14
            says.push({ text: SAYINGS[Math.floor(Math.random() * SAYINGS.length)]!, x: b.x + SPRITE_W / 2, y: GROUND - SPRITE_H - 1, life: 50 })
            continue
          }
          const target = seeds.reduce<Seed | null>((best, s) => (!best || Math.abs(s.x - beak) < Math.abs(best.x - beak) ? s : best), null)
          if (target) b.dir = target.x > beak ? 1 : -1
          // A bird never walks into another: one in the way turns it round.
          if (birds.some((o) => o !== b && Math.sign(o.x - b.x) === b.dir && Math.abs(o.x - b.x) < SPRITE_W + 2)) b.dir = b.dir === 1 ? -1 : 1
          if (b.x < 1) b.dir = 1
          if (b.x > cols - SPRITE_W - 1) b.dir = -1
          b.hop = 8
          b.rest = 6 + Math.floor(Math.random() * 18)
        }
      }
      says = says.filter((s) => --s.life > 0)
    }

    const draw = () => {
      ctx.clearRect(0, 0, el.width, el.height)
      ctx.globalAlpha = 0.055
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < cols; x++) cellAt(x, y, theme.cell)
      ctx.globalAlpha = 1
      for (const s of seeds) cellAt(s.x, GROUND, theme.birds[2]!.beak)
      for (const b of birds) drawBird(b)
      if (bubbles) {
        bubbles.replaceChildren(
          ...says.map((s) => {
            const n = document.createElement("span")
            n.className = "bird-grid-say"
            n.textContent = s.text
            n.style.left = `${s.x * PITCH}px`
            n.style.top = `${s.y * PITCH}px`
            n.style.opacity = String(Math.min(1, s.life / 10))
            return n
          }),
        )
      }
    }

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      if (!visible || document.hidden || t - last < FRAME_MS) return
      last = t
      step()
      draw()
    }

    size()
    draw()
    if (!reduced) raf = requestAnimationFrame(loop)

    const resize = new ResizeObserver(() => {
      size()
      draw()
    })
    resize.observe(el)
    const seen = new IntersectionObserver(([entry]) => (visible = !!entry?.isIntersecting))
    seen.observe(el)
    const retheme = new MutationObserver(() => {
      theme = readTheme(el)
      birds.forEach((b, i) => (b.palette = theme.birds[i] ?? b.palette))
      draw()
    })
    retheme.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-appearance", "data-material", "class"] })

    onCleanup(() => {
      cancelAnimationFrame(raf)
      resize.disconnect()
      seen.disconnect()
      retheme.disconnect()
    })
  })

  return (
    <div class="bird-grid" data-component="bird-grid" aria-hidden="true">
      <canvas ref={canvas} class="bird-grid-canvas" />
      <div ref={bubbles} class="bird-grid-says" />
    </div>
  )
}
