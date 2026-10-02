import { Show, type JSX } from "solid-js"
import { loadOverlaysV2, part } from "./overlays"
import type { TooltipV2Props } from "./tooltip-v2-impl"
import "./tooltip-v2.css"

export type { TooltipV2Props } from "./tooltip-v2-impl"

/*
 * The real tooltip lives in tooltip-v2-impl.tsx and loads after first paint. See overlays.tsx.
 * Until then the trigger is the same div a closed tooltip renders.
 */
function ClosedTooltip(props: TooltipV2Props): JSX.Element {
  const intent = () => void loadOverlaysV2()
  return (
    <Show when={!props.inactive} fallback={props.children}>
      <div data-component="tooltip-v2-trigger" class={props.class} onPointerEnter={intent} onFocusIn={intent}>
        {props.children}
      </div>
    </Show>
  )
}

export const TooltipV2 = part<(props: TooltipV2Props) => JSX.Element>((i) => i.TooltipV2, ClosedTooltip)
