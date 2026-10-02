import { createSignal, splitProps, type JSX } from "solid-js"
import { part } from "./overlays"
import type { DismissableLayerV2HooksProps } from "./dismissable-layer-v2-impl"

export interface DismissableLayerV2Props extends JSX.HTMLAttributes<HTMLDivElement> {
  active: boolean
  onDismiss: () => void
  excludedElements?: () => (Element | undefined)[]
}

/* The outside-click, escape and focus behaviour is Kobalte's and loads with the overlays chunk. */
const Hooks = part<(props: DismissableLayerV2HooksProps) => JSX.Element>((i) => i.DismissableLayerV2Hooks)

export function DismissableLayerV2(props: DismissableLayerV2Props): JSX.Element {
  const [local, others] = splitProps(props, ["active", "onDismiss", "excludedElements"])
  const [element, setElement] = createSignal<HTMLDivElement>()

  return (
    <>
      <div ref={setElement} data-component="dismissable-layer-v2" tabIndex={-1} {...others} />
      <Hooks
        active={local.active}
        onDismiss={local.onDismiss}
        excludedElements={local.excludedElements}
        element={element}
      />
    </>
  )
}
