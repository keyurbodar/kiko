import { createEscapeKeyDown } from "@kobalte/core/primitives/create-escape-key-down"
import { createFocusScope } from "@kobalte/core/primitives/create-focus-scope"
import { createInteractOutside } from "@kobalte/core/primitives/create-interact-outside"
import { splitProps, type JSX } from "solid-js"

export interface DismissableLayerV2Props extends JSX.HTMLAttributes<HTMLDivElement> {
  active: boolean
  onDismiss: () => void
  excludedElements?: () => (Element | undefined)[]
}

export function DismissableLayerV2(props: DismissableLayerV2Props): JSX.Element {
  const [local, others] = splitProps(props, ["active", "onDismiss", "excludedElements"])
  let ref: HTMLDivElement | undefined

  createInteractOutside(
    {
      isDisabled: () => !local.active,
      shouldExcludeElement: (element) =>
        local.excludedElements?.().some((node) => node?.contains(element)) ?? false,
      onPointerDownOutside: (event) => {
        if (!event.defaultPrevented) local.onDismiss()
      },
      onFocusOutside: (event) => {
        if (!event.defaultPrevented) local.onDismiss()
      },
    },
    () => ref,
  )

  createEscapeKeyDown({
    isDisabled: () => !local.active,
    onEscapeKeyDown: (event) => {
      event.preventDefault()
      local.onDismiss()
    },
  })

  createFocusScope({ trapFocus: false }, () => (local.active ? ref : undefined))

  return (
    <div
      ref={(element) => {
        ref = element
      }}
      data-component="dismissable-layer-v2"
      tabIndex={-1}
      {...others}
    />
  )
}
