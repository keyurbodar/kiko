import { CheckIcon, CopyIcon } from "../../icons.gen"
import { RemixIcon, type IconSize } from "../../components/remix-icon"
import type { JSX } from "solid-js"
import "./copy-check-icon.css"

export interface CopyCheckIconProps {
  copied: boolean
  size?: IconSize
  class?: string
}

export function CopyCheckIcon(props: CopyCheckIconProps): JSX.Element {
  return (
    <span
      data-component="copy-check-icon"
      data-copied={props.copied ? "" : undefined}
      class={props.class}
      style={{ width: `${props.size ?? 16}px`, height: `${props.size ?? 16}px` }}
      aria-hidden="true"
    >
      <RemixIcon class="copy-check-icon-copy" icon={CopyIcon} size={props.size} />
      <RemixIcon class="copy-check-icon-check" icon={CheckIcon} size={props.size} />
    </span>
  )
}
