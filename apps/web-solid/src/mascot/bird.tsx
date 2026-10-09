import { createMemo } from "solid-js"
import { birdSvg, VIEWBOX, type BirdShape, type BirdSpec, type BirdState } from "./birds"
import { birdFor } from "./choices"
import "./bird.css"

const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * A bird. Give it a `slug` to draw that agent's bird, or a `spec` to draw a specific one. `state`
 * shows its mood in its eyes, and a working bird's ink line boils. `alive` lets one large idle
 * bird breathe and blink; a list of avatars stays still. `size` is the height in px: a mochi is
 * square, a loaf is wider than tall. Without a size the bird fills the box its class gives it.
 */
export function Bird(props: {
  slug?: string
  spec?: BirdSpec
  shape?: BirdShape
  size?: number
  state?: BirdState
  alive?: boolean
  /** A bird a scene plays with: it steers the gaze and lean through CSS variables and `data-face`. */
  expressive?: boolean
  ref?: (el: HTMLSpanElement) => void
  class?: string
}) {
  const spec = () => props.spec ?? birdFor(props.slug ?? "")
  const state = () => props.state ?? "idle"
  const shape = () => props.shape ?? "mochi"
  const box = () => VIEWBOX[shape()]
  const markup = createMemo(() => birdSvg(spec(), state(), { shape: shape(), size: props.size, still: reducedMotion, expressive: props.expressive }))
  return (
    <span
      ref={props.ref}
      class={`bird ${props.class ?? ""}`}
      data-component="bird"
      data-bird={`${spec().flavor}.${spec().outfit}`}
      data-shape={shape()}
      data-state={state()}
      data-alive={props.alive ? "" : undefined}
      data-expressive={props.expressive ? "" : undefined}
      style={props.size ? { width: `${Math.round((props.size * box()[2]) / box()[3])}px`, height: `${props.size}px` } : undefined}
      aria-hidden="true"
    >
      <svg viewBox={box().join(" ")} innerHTML={markup()} />
    </span>
  )
}
