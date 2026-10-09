import { createMemo } from "solid-js"
import { BIRD_VIEWBOX, birdSvg, type BirdSpec, type BirdState } from "./birds"
import { birdFor } from "./choices"
import "./bird.css"

/**
 * A bird. Give it a `slug` to draw that agent's bird, or a `spec` to draw a specific one.
 * `state` animates it; without one it stays still, because a list of moving avatars is motion
 * where nobody is waiting for anything. `alive` lets an idle bird blink and breathe. A bird of
 * 64 px or more stands on a soft shadow unless `ground` says otherwise. A bird under 48 px, or
 * one sized by its class, has a stubby tail: at avatar size the long one reads as a stick.
 */
export function Bird(props: { slug?: string; spec?: BirdSpec; size?: number; state?: BirdState; alive?: boolean; ground?: boolean; class?: string }) {
  const spec = () => props.spec ?? birdFor(props.slug ?? "")
  const state = () => props.state ?? "idle"
  const ground = () => props.ground ?? (props.size ?? 0) >= 64
  const stub = () => (props.size ?? 0) < 48
  const markup = createMemo(() => birdSvg(spec(), state(), { ground: ground(), stub: stub() }))
  return (
    <span
      class={`bird ${props.class ?? ""}`}
      data-component="bird"
      data-bird={`${spec().flavor}.${spec().outfit}`}
      data-state={state()}
      data-alive={props.alive ? "" : undefined}
      style={props.size ? { width: `${props.size}px`, height: `${props.size}px` } : undefined}
      aria-hidden="true"
    >
      <svg viewBox={BIRD_VIEWBOX} innerHTML={markup()} />
    </span>
  )
}
