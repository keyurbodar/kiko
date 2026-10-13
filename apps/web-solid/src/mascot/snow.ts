// Snowfall on a canvas: the weather behind the empty chat and the sidebar's header. Flakes are
// soft-edged and fall at many depths: far ones tiny and slow, near ones larger, and a few very
// near ones big, faint and out of focus. A slow, changing wind carries them all, and each flake
// sways on its own. The color is the canvas's CSS `color`, so a theme sets it. It runs at 30
// frames a second, stops while the tab is hidden or the canvas is off screen, and paints one
// still frame under reduced motion.

export type SnowOptions = {
  /** Flakes per 10,000 square px. */
  density: number
  /** Radius range in px, far to near. */
  sizes: readonly [number, number]
  /** 1 is a calm fall. */
  speed?: number
  /** Opacity range, far to near. */
  alpha?: readonly [number, number]
  /** Share of flakes that are very near and out of focus. */
  bokeh?: number
}

type Flake = { x: number; y: number; depth: number; phase: number; near: boolean }

const FRAME_MS = 1000 / 30

/**
 * A soft flake, drawn once and stamped for every flake: a bright core in `color` that fades
 * through a faint cool rim, so snow reads on paper as well as on charcoal.
 */
function sprite(color: string): HTMLCanvasElement {
  const c = document.createElement("canvas")
  c.width = c.height = 32
  const g = c.getContext("2d")!
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16)
  grad.addColorStop(0, color)
  grad.addColorStop(0.38, color)
  grad.addColorStop(0.62, "rgba(120, 142, 168, 0.32)")
  grad.addColorStop(1, "rgba(120, 142, 168, 0)")
  g.fillStyle = grad
  g.fillRect(0, 0, 32, 32)
  return c
}

/** The wind in px a second at a moment: slow swells and the odd gust, never a steady push. */
const wind = (t: number) => Math.sin(t / 7100) * 9 + Math.sin(t / 2900 + 1.3) * 5 + Math.max(0, Math.sin(t / 11000 + 4)) ** 6 * 22

export function startSnow(canvas: HTMLCanvasElement, opts: SnowOptions): () => void {
  const ctx = canvas.getContext("2d")
  if (!ctx) return () => {}
  const [minR, maxR] = opts.sizes
  const [minA, maxA] = opts.alpha ?? [0.25, 0.8]
  const speed = opts.speed ?? 1
  const bokeh = opts.bokeh ?? 0.04
  let w = 0
  let h = 0
  let flakes: Flake[] = []
  let disc = sprite("#fff")

  const spawn = (top: boolean): Flake => ({
    x: Math.random() * (w + 80) - 40,
    y: top ? -maxR * 6 : Math.random() * h,
    depth: Math.random() ** 1.8,
    phase: Math.random() * Math.PI * 2,
    near: Math.random() < bokeh,
  })

  const recolor = () => (disc = sprite(getComputedStyle(canvas).color || "#fff"))

  const size = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    w = canvas.clientWidth
    h = canvas.clientHeight
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const want = Math.round(((w * h) / 10_000) * opts.density)
    while (flakes.length < want) flakes.push(spawn(false))
    flakes.length = want
  }

  const draw = (t: number) => {
    ctx.clearRect(0, 0, w, h)
    for (const f of flakes) {
      const r = f.near ? maxR * 3.2 : minR + (maxR - minR) * f.depth
      const sway = Math.sin(t / (1400 + f.depth * 900) + f.phase) * (3 + f.depth * 9)
      ctx.globalAlpha = f.near ? minA * 0.9 : minA + (maxA - minA) * f.depth
      // The sprite's solid core is under half its radius, so a near flake is drawn wider and softer.
      const d = r * (f.near ? 3.4 : 2.6)
      ctx.drawImage(disc, f.x + sway - d / 2, f.y - d / 2, d, d)
    }
    ctx.globalAlpha = 1
  }

  const step = (t: number, dt: number) => {
    const gust = wind(t)
    for (const f of flakes) {
      const near = f.near ? 1.6 : 1
      f.y += (9 + f.depth * 24) * speed * near * dt
      f.x += gust * (0.35 + f.depth * 0.8) * near * dt
      if (f.y > h + maxR * 6 || f.x > w + 60 || f.x < -60) Object.assign(f, spawn(true), f.x > w + 60 ? { x: -40 } : f.x < -60 ? { x: w + 40 } : {})
    }
  }

  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
  let raf = 0
  let last = 0
  let visible = true
  const loop = (t: number) => {
    raf = requestAnimationFrame(loop)
    if (!visible || document.hidden || t - last < FRAME_MS) return
    step(t, Math.min(0.1, (t - (last || t)) / 1000))
    last = t
    draw(t)
  }

  size()
  recolor()
  draw(0)
  if (!reduced) raf = requestAnimationFrame(loop)
  const resize = new ResizeObserver(() => (size(), draw(last)))
  resize.observe(canvas)
  const seen = new IntersectionObserver(([entry]) => (visible = !!entry?.isIntersecting))
  seen.observe(canvas)
  // A theme change recolors the snow.
  const retheme = new MutationObserver(() => (recolor(), draw(last)))
  retheme.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] })

  return () => {
    cancelAnimationFrame(raf)
    resize.disconnect()
    seen.disconnect()
    retheme.disconnect()
  }
}
