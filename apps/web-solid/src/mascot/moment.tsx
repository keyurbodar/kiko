import { KIKO } from "@kiko/protocol"
import { For } from "solid-js"
import { Bird } from "./bird"
import { birdFor } from "./choices"
import "./moment.css"

/*
 * Small moments for the quiet corners of the app, each one a habit of the real bird:
 *   nothing  it hangs upside down from a snowy twig and sways, over an empty result
 *   nest     it dozes in its nest, a z drifting up, over an empty list
 *   cheer    a dango row of birds hops once and petals fall, when something first works
 * CSS only, and still under reduced motion.
 */

export type MomentKind = "nothing" | "nest" | "cheer"

export default function Moment(props: { kind: MomentKind; faces?: readonly string[] }) {
  const faces = () => (props.faces?.length ? props.faces : [KIKO]).slice(0, props.kind === "cheer" ? 3 : 1)
  return (
    <span class="moment" data-component="moment" data-kind={props.kind} aria-hidden="true">
      {props.kind === "nothing" && (
        <>
          <svg class="moment-twig" viewBox="0 0 64 12">
            <path d="M2 7 C18 5 36 8 62 4" />
            <ellipse cx="14" cy="5" rx="6" ry="2" />
            <ellipse cx="50" cy="4" rx="7" ry="2" />
          </svg>
          <span class="moment-hang">
            <Bird spec={birdFor(faces()[0]!)} size={40} />
          </span>
        </>
      )}
      {props.kind === "nest" && (
        <>
          <Bird spec={birdFor(faces()[0]!)} size={44} state="sleeping" />
          <svg class="moment-nest" viewBox="0 0 64 20">
            <path d="M6 4 C10 18 54 18 58 4 C46 9 18 9 6 4Z" />
            <path class="moment-straw" d="M10 7 L22 12 M54 7 L42 12 M24 13 L40 9 M18 9 L30 14" />
          </svg>
        </>
      )}
      {props.kind === "cheer" && (
        <>
          <span class="moment-dango">
            <For each={faces()}>{(slug, i) => <span class="moment-hop" style={{ "--i": i() }}><Bird spec={birdFor(slug)} size={34} state="wave" /></span>}</For>
          </span>
          <span class="moment-petals">
            <For each={[0, 1, 2, 3, 4, 5]}>{(i) => <span style={{ left: `${(i * 41 + 6) % 100}%`, "--i": i }} />}</For>
          </span>
        </>
      )}
    </span>
  )
}
