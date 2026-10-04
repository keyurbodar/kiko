import { onCleanup, onMount } from "solid-js"
import { birdFor } from "../../mascot/choices"
import { BIRD_W, birdPixels, type Pixels } from "../../mascot/pixel/sprite"
import { runStage, type Stage } from "../../mascot/pixel/stage"
import "./bird-grid.css"

/*
 * The empty chat's pixel field, after monocode's arcade grid: the chat's own agents as pixel
 * birds, hopping along the ground toward seeds and saying so when they find one. The stage
 * owns the loop, the pausing and reduced motion; this file is the scene.
 */

const ROWS = 22
const GROUND = 19
const SAYINGS = ["seed acquired", "chirp", "yum", "one more", "found one", "hi"]

type Bird = { x: number; dir: 1 | -1; hop: number; peck: number; rest: number; pixels: Pixels }
type Seed = { x: number; life: number }
type Say = { text: string; x: number; y: number; life: number }

export default function BirdGrid(props: { faces: readonly string[] }) {
  let canvas: HTMLCanvasElement | undefined
  let bubbles: HTMLDivElement | undefined

  onMount(() => {
    const faces = (props.faces.length ? props.faces : ["kiko"]).slice(0, 3)
    let birds: Bird[] = []
    let seeds: Seed[] = []
    let says: Say[] = []

    const groundY = (b: Bird) => {
      const lift = b.hop > 0 ? Math.round(Math.sin((b.hop / 8) * Math.PI) * 2) : 0
      return GROUND - b.pixels.h + 1 - lift + (b.peck > 0 ? 1 : 0)
    }

    const stop = runStage(canvas!, { cell: 6, gap: 1, rows: ROWS, board: 0.055 }, {
      setup(stage) {
        if (birds.length) return
        birds = faces.map((slug, i) => ({
          x: Math.floor(((i + 1) * stage.cols) / (faces.length + 1)) - BIRD_W / 2,
          dir: i % 2 ? -1 : 1,
          hop: 0,
          peck: 0,
          rest: 20 + i * 15,
          pixels: birdPixels(birdFor(slug)),
        }))
      },
      step(stage) {
        const cols = stage.cols
        if (Math.random() < 0.04 && seeds.length < 4) seeds.push({ x: 2 + Math.floor(Math.random() * (cols - 4)), life: 400 })
        seeds = seeds.filter((s) => --s.life > 0)
        for (const b of birds) {
          if (b.peck > 0) {
            b.peck--
            continue
          }
          if (b.hop > 0) {
            b.hop--
            b.x += b.dir * 0.35
            continue
          }
          if (b.rest > 0) {
            b.rest--
            continue
          }
          const beak = b.dir === 1 ? b.x + BIRD_W - 1 : b.x
          const seed = seeds.find((s) => Math.abs(s.x - beak) < 1.5)
          if (seed) {
            seeds = seeds.filter((s) => s !== seed)
            b.peck = 14
            says.push({ text: SAYINGS[Math.floor(Math.random() * SAYINGS.length)]!, x: b.x + BIRD_W / 2, y: GROUND - b.pixels.h - 1, life: 50 })
            continue
          }
          const target = seeds.reduce<Seed | null>((best, s) => (!best || Math.abs(s.x - beak) < Math.abs(best.x - beak) ? s : best), null)
          if (target) b.dir = target.x > beak ? 1 : -1
          // A bird never walks into another: one in the way turns it round.
          if (birds.some((o) => o !== b && Math.sign(o.x - b.x) === b.dir && Math.abs(o.x - b.x) < BIRD_W + 2)) b.dir = b.dir === 1 ? -1 : 1
          if (b.x < 1) b.dir = 1
          if (b.x > cols - BIRD_W - 1) b.dir = -1
          b.hop = 8
          b.rest = 6 + Math.floor(Math.random() * 18)
        }
        says = says.filter((s) => --s.life > 0)
      },
      draw(stage: Stage) {
        for (const s of seeds) stage.cell(s.x, GROUND, "#FFA14A")
        for (const b of birds) stage.sprite(b.pixels, Math.round(b.x), groundY(b), b.dir === -1)
        if (!bubbles) return
        bubbles.replaceChildren(
          ...says.map((s) => {
            const n = document.createElement("span")
            n.className = "bird-grid-say"
            n.textContent = s.text
            n.style.left = `${s.x * 7}px`
            n.style.top = `${s.y * 7}px`
            n.style.opacity = String(Math.min(1, s.life / 10))
            return n
          }),
        )
      },
    })
    onCleanup(stop)
  })

  return (
    <div class="bird-grid" data-component="bird-grid" aria-hidden="true">
      <canvas ref={canvas} class="bird-grid-canvas" />
      <div ref={bubbles} class="bird-grid-says" />
    </div>
  )
}
