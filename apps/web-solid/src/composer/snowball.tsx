import { createEffect, createSignal, on, onCleanup, Show } from "solid-js"
import { Bird } from "../mascot/bird"
import "./snowball.css"

/*
 * While an agent works on your message, its bird plays on the composer's top edge: it pushes a
 * snowball that slowly grows as it rolls, and at the end of the edge it scoots round behind the
 * ball and pushes it back the other way. When the reply lands the snowball bursts into a puff of
 * snow, the bird beams, and it slips away. After monocode's composer runner (MIT,
 * src/features/sessions/ui/ComposerRunner.tsx), in Kiko's own game. Under reduced motion the
 * bird only sits on the edge while the agent works.
 */

const SIZE = 36
/** Half a mochi's body, and how far its base sits down its box. */
const HALF = 0.39 * SIZE
const BASE = 0.75
const SPEED = 24
const INSET = 18
const GONE_MS = 1100

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches

export function Snowball(props: { slug: string | null; dock: () => HTMLElement | undefined }) {
  const [shown, setShown] = createSignal<string | null>(null)
  let layer: HTMLDivElement | undefined
  let mover: HTMLSpanElement | undefined
  let bird: HTMLSpanElement | undefined
  let ball: HTMLSpanElement | undefined
  let raf = 0
  let leaving: ReturnType<typeof setTimeout> | undefined

  /** The composer card's top edge, and its width, inside the dock. */
  const ledge = () => {
    const dock = props.dock()
    const row = dock?.querySelector<HTMLElement>(".composer-row")
    if (!dock || !row) return null
    const d = dock.getBoundingClientRect()
    const r = row.getBoundingClientRect()
    return { top: r.top - d.top, left: r.left - d.left + INSET, width: r.width - INSET * 2 }
  }

  const run = () => {
    if (!layer || !mover || !bird || !ball) return
    const start = performance.now()
    let x = 0
    let dir: 1 | -1 = 1
    let turning = 0
    let last = start
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick)
      const l = ledge()
      if (!l || !layer || !mover || !bird || !ball) return
      layer.style.translate = `${l.left}px ${l.top}px`
      const dt = Math.min(0.05, (t - last) / 1000)
      last = t
      const r = Math.min(9, 3 + (t - start) / 2400)
      if (turning > 0) {
        // Round the back of the ball to its other side; the ball sits still in front.
        turning -= dt
        x += -dir * SPEED * 2.2 * dt
        if (turning <= 0) dir = dir === 1 ? -1 : 1
      } else {
        x += dir * SPEED * dt
        const ballEdge = x + dir * (HALF + 2 * r)
        if (ballEdge > l.width || ballEdge < 0) turning = (2 * (HALF + r)) / (SPEED * 2.2)
      }
      x = Math.max(0, Math.min(l.width, x))
      const ballX = turning > 0 ? (dir === 1 ? l.width - r : r) : x + dir * (HALF + r - 2)
      const sway = Math.sin(t / 60) * 3
      mover.style.translate = `${(x - SIZE / 2).toFixed(1)}px ${(-BASE * SIZE + 2).toFixed(1)}px`
      bird.style.setProperty("--tilt", `${(dir * 5 + sway).toFixed(2)}deg`)
      bird.style.setProperty("--look-x", `${(turning > 0 ? -dir : dir) * 1.6}px`)
      ball.style.translate = `${(ballX - r).toFixed(1)}px ${(-2 * r + 1).toFixed(1)}px`
      ball.style.width = ball.style.height = `${(2 * r).toFixed(1)}px`
      ball.style.rotate = `${((ballX / r) * 57.3).toFixed(0)}deg`
    }
    raf = requestAnimationFrame(tick)
  }

  /** The reply landed: the snowball bursts into a puff, the bird beams, and it slips away. */
  const finish = () => {
    cancelAnimationFrame(raf)
    if (ball && layer && !reduced()) {
      const b = ball.getBoundingClientRect()
      const l = layer.getBoundingClientRect()
      const cx = b.left - l.left + b.width / 2
      const cy = b.top - l.top + b.height / 2
      ball.animate([{ scale: "1", opacity: 1 }, { scale: "1.6", opacity: 0 }], { duration: 260, easing: "ease-out", fill: "forwards" })
      for (let i = 0; i < 10; i++) {
        const p = document.createElement("span")
        p.className = "snowball-puff"
        p.style.translate = `${cx}px ${cy}px`
        layer.append(p)
        const a = (i / 10) * Math.PI * 2 + Math.random() * 0.5
        const d = 14 + Math.random() * 16
        p.animate(
          [
            { translate: `${cx}px ${cy}px`, opacity: 1, scale: "1" },
            { translate: `${(cx + Math.cos(a) * d).toFixed(1)}px ${(cy + Math.sin(a) * d * 0.7 - 6).toFixed(1)}px`, opacity: 0, scale: "0.4" },
          ],
          { duration: 620, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" },
        ).onfinish = () => p.remove()
      }
    }
    if (bird) bird.dataset.face = "happy"
    mover?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: GONE_MS - 300, fill: "forwards" })
    leaving = setTimeout(() => setShown(null), GONE_MS)
  }

  createEffect(
    on(
      () => props.slug,
      (slug, before) => {
        if (slug && !before) {
          clearTimeout(leaving)
          setShown(slug)
          if (!reduced()) queueMicrotask(run)
          else queueMicrotask(() => {
            const l = ledge()
            if (l && layer && mover) ((layer.style.translate = `${l.left}px ${l.top}px`), (mover.style.translate = `${l.width / 2 - SIZE / 2}px ${-BASE * SIZE + 2}px`))
          })
        } else if (!slug && before && shown()) finish()
      },
    ),
  )
  onCleanup(() => (cancelAnimationFrame(raf), clearTimeout(leaving)))

  return (
    <Show when={shown()}>
      {(slug) => (
        <div ref={layer} class="snowball" data-component="composer-snowball" aria-hidden="true">
          <span ref={ball} class="snowball-ball" />
          <span ref={mover} class="snowball-bird">
            <Bird slug={slug()} size={SIZE} expressive ref={(el) => (bird = el)} />
          </span>
        </div>
      )}
    </Show>
  )
}
