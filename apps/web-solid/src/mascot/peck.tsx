import { For, onCleanup, onMount } from "solid-js"
import { Bird } from "./bird"
import "./peck.css"

/*
 * The empty chat's game, after the old Kiko field: the chat's birds forage. A seed drops softly
 * onto the floor, the nearest bird scoots over with a little waddle, leaning the way it goes,
 * pecks twice, and a small word rises over it: "Yum", "Found one". Now and then a bird stops to
 * look at you and beam. Birds turn round rather than walk into each other. They never hop.
 * Under reduced motion they sit still, side by side.
 */

const W = 560
const H = 128
const FLOOR = 112
const SIZE = 76
const HALF = 0.39 * SIZE
const SPEED = 46
const SAYINGS = ["Yum", "Found one", "One more", "Mm", "Crunchy", "Another!", "Hehe", "Seed!"]

type Seed = { el: HTMLSpanElement; x: number; y: number; vy: number; landed: boolean; taken: boolean }
type Forager = {
  el: HTMLSpanElement
  mover: HTMLSpanElement
  x: number
  dir: 1 | -1
  goal: Seed | null
  peck: number
  rest: number
  beam: number
  tilt: number
}

const rand = (a: number, b: number) => a + Math.random() * (b - a)

export function Peck(props: { faces: readonly string[] }) {
  const faces = () => props.faces.slice(0, 3)
  let stage: HTMLDivElement | undefined
  const birds: HTMLSpanElement[] = []
  const movers: HTMLSpanElement[] = []
  const start = (i: number, n: number) => ((i + 1) * W) / (n + 1)

  onMount(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const n = birds.length
    const foragers: Forager[] = birds.map((el, i) => ({ el, mover: movers[i]!, x: start(i, n), dir: i % 2 ? -1 : 1, goal: null, peck: 0, rest: 600 + i * 700, beam: 0, tilt: 0 }))
    let seeds: Seed[] = []
    let nextSeed = 400
    let last = performance.now()
    let raf = 0

    const drop = () => {
      const el = document.createElement("span")
      el.className = "peck-seed"
      stage!.append(el)
      seeds.push({ el, x: rand(30, W - 30), y: -10, vy: 0, landed: false, taken: false })
    }

    const say = (f: Forager) => {
      const el = document.createElement("span")
      el.className = "peck-say"
      el.textContent = SAYINGS[Math.floor(Math.random() * SAYINGS.length)]!
      el.style.left = `${f.x}px`
      el.style.top = `${FLOOR - SIZE * 0.62}px`
      stage!.append(el)
      el.addEventListener("animationend", () => el.remove())
    }

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (t - last) / 1000)
      last = t
      if (document.hidden) return
      nextSeed -= dt * 1000
      if (nextSeed <= 0 && seeds.filter((s) => !s.taken).length < 3) {
        drop()
        nextSeed = rand(1400, 3200)
      }
      // Seeds fall softly and settle with a tiny bounce.
      for (const s of seeds) {
        if (s.landed) continue
        s.vy += 260 * dt
        s.y += s.vy * dt
        if (s.y >= FLOOR - 3) {
          s.y = FLOOR - 3
          s.vy = Math.abs(s.vy) > 40 ? -s.vy * 0.25 : 0
          if (s.vy === 0) s.landed = true
        }
        s.el.style.translate = `${s.x.toFixed(1)}px ${s.y.toFixed(1)}px`
      }
      for (const f of foragers) {
        let wantTilt = 0
        let lookX = f.dir * 1.2
        let lookY = 0.4
        if (f.beam > 0) {
          // A pause to look at you, content.
          f.beam -= dt * 1000
          f.el.dataset.face = "happy"
          lookX = 0
          lookY = 0
          if (f.beam <= 0) delete f.el.dataset.face
        } else if (f.peck > 0) {
          // Two pecks: lean down to the seed and back, twice.
          f.peck -= dt * 1000
          const p = 1 - f.peck / 900
          wantTilt = f.dir * Math.max(0, Math.sin(p * Math.PI * 2)) * 16
          lookY = 1.4
          if (f.peck <= 0) {
            if (f.goal) {
              f.goal.el.remove()
              seeds = seeds.filter((s) => s !== f.goal)
              f.goal = null
              say(f)
            }
            f.rest = rand(500, 1600)
            if (Math.random() < 0.3) f.beam = 1400
          }
        } else if (f.rest > 0) {
          f.rest -= dt * 1000
          lookX = Math.sin(t / 700 + f.x) * 1.2
        } else {
          // Find the nearest free seed and scoot to it; otherwise wander a little.
          if (!f.goal || f.goal.taken !== true) {
            const free = seeds.filter((s) => s.landed && !s.taken)
            const nearest = free.sort((a, b) => Math.abs(a.x - f.x) - Math.abs(b.x - f.x))[0]
            if (nearest) {
              nearest.taken = true
              f.goal = nearest
            }
          }
          const target = f.goal ? f.goal.x - f.dir * (HALF - 4) : null
          if (f.goal) f.dir = f.goal.x >= f.x ? 1 : -1
          const blocked = foragers.some((o) => o !== f && Math.sign(o.x - f.x) === f.dir && Math.abs(o.x - f.x) < SIZE * 0.85)
          if (blocked && f.goal) {
            // Someone is in the way: let them have it, and turn round.
            f.goal.taken = false
            f.goal = null
            f.dir = f.dir === 1 ? -1 : 1
            f.rest = 500
          } else if (target !== null && Math.abs(target - f.x) > 2) {
            f.x += f.dir * SPEED * dt
            wantTilt = f.dir * 5 + Math.sin(t / 70) * 4
          } else if (f.goal) {
            f.peck = 900
          } else {
            f.rest = rand(700, 1800)
            if (Math.random() < 0.5) f.dir = f.dir === 1 ? -1 : 1
          }
        }
        f.x = Math.max(HALF, Math.min(W - HALF, f.x))
        f.tilt += (wantTilt - f.tilt) * 0.25
        f.mover.style.translate = `${(f.x - SIZE / 2).toFixed(1)}px 0`
        f.el.style.setProperty("--tilt", `${f.tilt.toFixed(2)}deg`)
        f.el.style.setProperty("--look-x", `${lookX.toFixed(2)}px`)
        f.el.style.setProperty("--look-y", `${lookY.toFixed(2)}px`)
      }
    }
    raf = requestAnimationFrame(tick)
    onCleanup(() => {
      cancelAnimationFrame(raf)
      for (const s of seeds) s.el.remove()
    })
  })

  return (
    <div ref={stage} class="peck" style={{ width: `${W}px`, height: `${H}px` }} aria-hidden="true">
      <For each={faces()}>
        {(slug, i) => (
          <span ref={(el) => (movers[i()] = el)} class="peck-bird" style={{ top: `${FLOOR - 0.75 * SIZE}px`, translate: `${start(i(), faces().length) - SIZE / 2}px 0` }}>
            <span class="peck-shadow" />
            <Bird slug={slug} size={SIZE} alive expressive ref={(el) => (birds[i()] = el)} />
          </span>
        )}
      </For>
    </div>
  )
}
