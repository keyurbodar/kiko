import { YUKI } from "@yuki/protocol"
import { For } from "solid-js"
import { Bird } from "./bird"
import { birdFor } from "./choices"

/*
 * Small still drawings for the quiet corners of the app. Nothing here moves.
 *   nothing  a bird glancing up, over an empty result
 *   nest     a bird asleep, over an empty list
 *   cheer    a row of birds with happy eyes, when something first works
 */

export type MomentKind = "nothing" | "nest" | "cheer"

const STATE = { nothing: "thinking", nest: "sleeping", cheer: "wave" } as const

export default function Moment(props: { kind: MomentKind; faces?: readonly string[] }) {
  const faces = () => (props.faces?.length ? props.faces : [YUKI]).slice(0, props.kind === "cheer" ? 3 : 1)
  return (
    <span class="inline-flex items-end" data-component="moment" data-kind={props.kind} aria-hidden="true">
      <For each={faces()}>{(slug, i) => <span style={{ "margin-left": i() ? "-10px" : undefined }}><Bird spec={birdFor(slug)} size={44} state={STATE[props.kind]} /></span>}</For>
    </span>
  )
}
