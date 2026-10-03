import { createMemo } from "solid-js"
import { birdSvg, type BirdSpec, type BirdState } from "./birds"
import { birdFor } from "./choices"
import "./bird.css"

/**
 * A bird. Give it a `slug` to draw that agent's bird, or a `spec` to draw a specific one.
 * `state` animates it; without one it stays still, because a list of moving avatars is motion
 * where nobody is waiting for anything. `alive` lets a large idle bird blink now and then.
 */
export function Bird(props: { slug?: string; spec?: BirdSpec; size?: number; state?: BirdState; alive?: boolean; class?: string }) {
  const spec = () => props.spec ?? birdFor(props.slug ?? "")
  const state = () => props.state ?? "idle"
  const markup = createMemo(() => birdSvg(spec(), state()))
  return (
    <span
      class={`bird ${props.class ?? ""}`}
      data-component="bird"
      data-bird={`${spec().species}.${spec().tint}.${spec().accessory}`}
      data-state={state()}
      data-alive={props.alive ? "" : undefined}
      style={props.size ? { width: `${props.size}px`, height: `${props.size}px` } : undefined}
      aria-hidden="true"
    >
      {/* Square, and centred on the bird's outline (x 16 to 92, y 16 to 91), so it sits in the middle of any box. */}
      <svg viewBox="2 1.5 104 104" innerHTML={markup()} />
    </span>
  )
}
