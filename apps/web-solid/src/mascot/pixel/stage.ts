// The one runtime under every pixel scene: a canvas of square cells, a loop at 30 frames a
// second, and the rules every scene shares. It stops while the tab is hidden or the canvas is
// off screen, draws one still frame for reduced motion, and repaints when the theme changes.
// A scene is plain data plus three functions; it never touches the canvas API itself.

import type { Pixels } from "./sprite"

export type StageOptions = {
  /** Cell size and gap in CSS pixels. */
  cell: number
  gap: number
  rows: number
  /** Fixed columns. Without it the board fills the canvas's width. */
  cols?: number
  /** Opacity of the dim board behind the scene. 0 draws no board. */
  board?: number
  fps?: number
}

export type Stage = {
  readonly cols: number
  readonly rows: number
  /** A theme token's colour, such as `--text`, resolved for the canvas. */
  token(name: string): string
  cell(x: number, y: number, css: string, alpha?: number): void
  sprite(p: Pixels, x: number, y: number, flip?: boolean, alpha?: number): void
}

export type Scene = {
  /** On mount and on every resize. */
  setup?(stage: Stage): void
  /** One frame of motion. Never called under reduced motion. */
  step?(stage: Stage, frame: number): void
  draw(stage: Stage): void
}

export function runStage(canvas: HTMLCanvasElement, opts: StageOptions, scene: Scene): () => void {
  const ctx = canvas.getContext("2d")
  if (!ctx) return () => {}
  const pitch = opts.cell + opts.gap
  const probe = document.createElement("span")
  probe.style.display = "none"
  canvas.after(probe)
  const resolved = new Map<string, string>()
  const resolve = (css: string) => {
    let out = resolved.get(css)
    if (out === undefined) {
      probe.style.color = ""
      probe.style.color = css
      out = getComputedStyle(probe).color || css
      resolved.set(css, out)
    }
    return out
  }

  let cols = opts.cols ?? 1
  const stage: Stage = {
    get cols() {
      return cols
    },
    rows: opts.rows,
    token: (name) => resolve(`var(${name})`),
    cell(x, y, css, alpha = 1) {
      if (x < 0 || y < 0 || x >= cols || y >= opts.rows) return
      ctx.globalAlpha = alpha
      ctx.fillStyle = resolve(css)
      ctx.fillRect(Math.round(x) * pitch, Math.round(y) * pitch, opts.cell, opts.cell)
    },
    sprite(p, x, y, flip = false, alpha = 1) {
      for (let r = 0; r < p.h; r++) {
        for (let c = 0; c < p.w; c++) {
          const color = p.cells[r * p.w + (flip ? p.w - 1 - c : c)]
          if (color) stage.cell(x + c, y + r, color, alpha)
        }
      }
    },
  }

  const paint = () => {
    ctx.globalAlpha = 1
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (opts.board) {
      const ink = resolve("var(--text)")
      for (let y = 0; y < opts.rows; y++) for (let x = 0; x < cols; x++) stage.cell(x, y, ink, opts.board)
    }
    scene.draw(stage)
    ctx.globalAlpha = 1
  }

  const size = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cols = opts.cols ?? Math.max(8, Math.floor((canvas.clientWidth + opts.gap) / pitch))
    canvas.width = Math.round(cols * pitch * dpr)
    canvas.height = Math.round(opts.rows * pitch * dpr)
    canvas.style.height = `${opts.rows * pitch}px`
    if (opts.cols) canvas.style.width = `${cols * pitch}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    scene.setup?.(stage)
    paint()
  }

  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
  const frameMs = 1000 / (opts.fps ?? 30)
  let raf = 0
  let last = 0
  let frame = 0
  let visible = true
  const loop = (t: number) => {
    raf = requestAnimationFrame(loop)
    if (!visible || document.hidden || t - last < frameMs) return
    last = t
    scene.step?.(stage, frame++)
    paint()
  }

  size()
  if (!reduced && scene.step) raf = requestAnimationFrame(loop)
  const resize = new ResizeObserver(size)
  resize.observe(canvas)
  const seen = new IntersectionObserver(([entry]) => (visible = !!entry?.isIntersecting))
  seen.observe(canvas)
  const retheme = new MutationObserver(() => {
    resolved.clear()
    paint()
  })
  retheme.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-appearance", "data-material", "class"] })

  return () => {
    cancelAnimationFrame(raf)
    resize.disconnect()
    seen.disconnect()
    retheme.disconnect()
    probe.remove()
  }
}
