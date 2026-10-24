import type { JSX } from "solid-js"
import { cn } from "../../lib/cn"
import "./mochi.css"

export function Mochi(props: { size?: number; class?: string }): JSX.Element {
  return (
    <span
      class={cn("mochi", props.class)}
      style={{ "--mochi-size": `${props.size ?? 16}px` }}
      data-component="mochi"
      aria-hidden="true"
    >
      <span class="mochi-shadow" />
      <span class="mochi-body" />
    </span>
  )
}
