// The painting kit for snowy places: seeded randomness, tapered limbs with frost and snow on
// them, birds set into a painting who live on their own, glints, and knocked-loose snow. Pure
// markup builders plus two small runtime helpers, shared by the empty chat and its preview page.

import { onCleanup, onMount } from "solid-js"
import { birdSvg, VIEWBOX, YUKI_BIRD, type BirdShape } from "./birds"

const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
export const smooth = (p: number) => 0.5 - Math.cos(Math.PI * clamp(p)) / 2
/** A seeded random source, so every painting is the same on every load. */
export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Pt = readonly [number, number]
export const f1 = (n: number) => n.toFixed(1)

/** Points along a smooth curve through `pts` (Catmull-Rom), `n` per span. */
export function curve(pts: readonly Pt[], n = 12): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!
    const p1 = pts[i]!
    const p2 = pts[i + 1]!
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!
    for (let j = 0; j < n; j++) {
      const t = j / n
      const t2 = t * t
      const t3 = t2 * t
      const at = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      out.push([at(p0[0], p1[0], p2[0], p3[0]), at(p0[1], p1[1], p2[1], p3[1])])
    }
  }
  out.push(pts[pts.length - 1]!)
  return out
}

/** A limb: a filled shape along a curve that tapers from `w0` to `w1`. Returns its path and its spine. */
export function limb(pts: readonly Pt[], w0: number, w1: number, wobble = 0, rand = Math.random): { d: string; spine: Pt[] } {
  const spine = curve(pts)
  const left: Pt[] = []
  const right: Pt[] = []
  spine.forEach(([x, y], i) => {
    const [nx0, ny0] = spine[Math.min(spine.length - 1, i + 1)]!
    const [px, py] = spine[Math.max(0, i - 1)]!
    const dx = nx0 - px
    const dy = ny0 - py
    const len = Math.hypot(dx, dy) || 1
    const w = (w0 + (w1 - w0) * (i / (spine.length - 1))) / 2 + (rand() - 0.5) * wobble
    left.push([x + (-dy / len) * w, y + (dx / len) * w])
    right.push([x - (-dy / len) * w, y - (dx / len) * w])
  })
  const ring = [...left, ...right.reverse()]
  return { d: `M${ring.map(([x, y]) => `${f1(x)} ${f1(y)}`).join(" L")}Z`, spine }
}

/** The height of a spine at `x`, for setting a bird on a branch. */
export function yAt(spine: readonly Pt[], x: number): number {
  for (let i = 1; i < spine.length; i++) {
    const [ax, ay] = spine[i - 1]!
    const [bx, by] = spine[i]!
    if ((x >= ax && x <= bx) || (x <= ax && x >= bx)) return ay + ((by - ay) * (x - ax)) / (bx - ax || 1)
  }
  return spine[spine.length - 1]![1]
}

/** A bare tree: a trunk that forks and forks again, as round-capped segments. */
export function bareTree(rand: () => number, x: number, y: number, len: number, angle: number, width: number, depth: number, out: { x1: number; y1: number; x2: number; y2: number; w: number }[] = []) {
  const x2 = x + Math.cos(angle) * len
  const y2 = y + Math.sin(angle) * len
  out.push({ x1: x, y1: y, x2, y2, w: width })
  if (depth > 0) {
    const kids = rand() < 0.35 ? 3 : 2
    for (let k = 0; k < kids; k++) {
      const turn = (k - (kids - 1) / 2) * (0.5 + rand() * 0.35) + (rand() - 0.5) * 0.3
      bareTree(rand, x2, y2, len * (0.66 + rand() * 0.14), angle + turn, width * 0.66, depth - 1, out)
    }
  }
  return out
}
export const segs = (s: ReturnType<typeof bareTree>, style: string) =>
  s.map((g) => `<line x1="${f1(g.x1)}" y1="${f1(g.y1)}" x2="${f1(g.x2)}" y2="${f1(g.y2)}" stroke-width="${f1(Math.max(0.6, g.w))}" style="${style}" stroke-linecap="round"/>`).join("")
// ----- birds --------------------------------------------------------------------------------

export type BirdAt = { x: number; y: number; size: number; shape?: BirdShape; flip?: boolean; sleepy?: boolean; id?: string; rotate?: number }

/** A bird set into a painting: its feet at (x, y). Alive birds blink, glance and lean on their own. */
export function birdAt(b: BirdAt): string {
  const shape = b.shape ?? "mochi"
  const [vx, vy, vw, vh] = VIEWBOX[shape]
  const w = (b.size * vw) / vh
  const top = b.y - ((101 - vy) / vh) * b.size
  const t = [b.flip ? `translate(${b.x * 2} 0) scale(-1 1)` : "", b.rotate ? `rotate(${b.rotate} ${b.x} ${b.y})` : ""].join(" ")
  return (
    `<g class="w-perch"${b.id ? ` data-id="${b.id}"` : ""} transform="${t}"><svg class="bird w-bird" data-shape="${shape}" data-expressive=""${b.sleepy ? ` data-face="closed" data-sleepy=""` : ""} x="${f1(b.x - w / 2)}" y="${f1(top)}" width="${f1(w)}" height="${b.size}" viewBox="${vx} ${vy} ${vw} ${vh}" overflow="visible">` +
    birdSvg(YUKI_BIRD, "idle", { shape, size: b.size, expressive: true }) +
    `</svg></g>`
  )
}

/** Every alive bird in `root` lives on its own clock: a blink, a glance, a lean, a happy squint. */
export function lifeIn(root: Element, dt: number, clocks: WeakMap<Element, number>) {
  for (const b of root.querySelectorAll<SVGSVGElement>(".w-bird")) {
    const left = (clocks.get(b) ?? 1 + Math.random() * 3) - dt
    if (left > 0) {
      clocks.set(b, left)
      continue
    }
    clocks.set(b, 1.6 + Math.random() * 3.4)
    const set = (k: string, v: number, unit: string) => b.style.setProperty(k, `${v.toFixed(1)}${unit}`)
    if (b.dataset.sleepy !== undefined) {
      set("--tilt", (Math.random() - 0.5) * 8, "deg")
      continue
    }
    const roll = Math.random()
    if (roll < 0.34) {
      b.dataset.face = "closed"
      setTimeout(() => b.dataset.face === "closed" && delete b.dataset.face, 150)
    } else if (roll < 0.7) {
      set("--look-x", (Math.random() - 0.5) * 4.4, "px")
      set("--look-y", (Math.random() - 0.6) * 2.6, "px")
    } else if (roll < 0.9) {
      set("--tilt", (Math.random() - 0.5) * 16, "deg")
    } else {
      b.dataset.face = "happy"
      setTimeout(() => b.dataset.face === "happy" && delete b.dataset.face, 1300)
    }
  }
}

/** Runs `frame(t, dt)` in seconds every animation frame while mounted, never under reduced motion. */
export function loop(frame: (t: number, dt: number) => void) {
  onMount(() => {
    if (reduced) return
    let raf = 0
    let last = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - (last || now)) / 1000)
      last = now
      frame(now / 1000, dt)
    }
    raf = requestAnimationFrame(tick)
    onCleanup(() => cancelAnimationFrame(raf))
  })
}

/** Little bits of snow knocked loose: they fall, drift and fade. Drawn as circles in the painting. */
export function spray(layer: () => SVGGElement) {
  type Bit = { el: SVGCircleElement; x: number; y: number; vx: number; vy: number; life: number }
  let bits: Bit[] = []
  return {
    add(x: number, y: number, n: number, up = 30) {
      for (let i = 0; i < n; i++) {
        const el = document.createElementNS("http://www.w3.org/2000/svg", "circle")
        el.setAttribute("r", (0.8 + Math.random() * 2.2).toFixed(1))
        el.setAttribute("class", "w-bit")
        layer().append(el)
        bits.push({ el, x: x + (Math.random() - 0.5) * 30, y, vx: (Math.random() - 0.5) * 40, vy: -Math.random() * up, life: 1.4 + Math.random() })
      }
    },
    step(dt: number) {
      bits = bits.filter((b) => {
        b.vy += 90 * dt
        b.x += b.vx * dt
        b.y += b.vy * dt
        b.life -= dt
        b.el.setAttribute("cx", f1(b.x))
        b.el.setAttribute("cy", f1(b.y))
        b.el.style.opacity = String(clamp(b.life))
        if (b.life > 0) return true
        b.el.remove()
        return false
      })
    },
  }
}

/** Twinkling glints, like frost or diamond dust catching the light. Positions in the painting. */
export function glints(rand: () => number, n: number, box: [number, number, number, number], size = 5): string {
  const [x0, y0, x1, y1] = box
  return Array.from({ length: n }, () => {
    const x = x0 + rand() * (x1 - x0)
    const y = y0 + rand() * (y1 - y0)
    const s = size * (0.4 + rand() * 0.8)
    return `<path class="w-glint" style="animation-delay:${f1(-rand() * 6)}s;animation-duration:${f1(2.5 + rand() * 4)}s" d="M${f1(x - s)} ${f1(y)} Q${f1(x)} ${f1(y)} ${f1(x)} ${f1(y - s)} Q${f1(x)} ${f1(y)} ${f1(x + s)} ${f1(y)} Q${f1(x)} ${f1(y)} ${f1(x)} ${f1(y + s)} Q${f1(x)} ${f1(y)} ${f1(x - s)} ${f1(y)}Z"/>`
  }).join("")
}

/** Hoarfrost: fine white needles growing off the top of a limb's spine. */
export function frost(rand: () => number, spine: readonly Pt[], reach: number, every = 3): string {
  let d = ""
  for (let i = 1; i < spine.length - 1; i += 1) {
    const [x, y] = spine[i]!
    const [nx, ny] = spine[i + 1]!
    const a = Math.atan2(ny - y, nx - x) - Math.PI / 2
    for (let k = 0; k < every; k++) {
      const ang = a + (rand() - 0.5) * 1.6
      const l = reach * (0.35 + rand() * 0.75)
      const sx = x + (rand() - 0.5) * 6
      const sy = y - 2 + rand() * 2
      d += `M${f1(sx)} ${f1(sy)} L${f1(sx + Math.cos(ang) * l)} ${f1(sy + Math.sin(ang) * l)} `
    }
  }
  return d
}

/** Snow lying along the top of a spine: a soft ridge, thickest in the middle. */
export function snowOn(spine: readonly Pt[], thick: number, lift = 0): string {
  const top: Pt[] = []
  const bottom: Pt[] = []
  spine.forEach(([x, y], i) => {
    const p = i / (spine.length - 1)
    const t = thick * Math.sin(Math.PI * clamp(p * 1.15 - 0.05)) ** 0.6
    top.push([x, y - lift - t])
    bottom.push([x, y - lift + 1])
  })
  const ring = [...top, ...bottom.reverse()]
  return `M${ring.map(([x, y]) => `${f1(x)} ${f1(y)}`).join(" L")}Z`
}
