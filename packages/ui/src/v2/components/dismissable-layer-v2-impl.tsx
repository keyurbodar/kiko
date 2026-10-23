import { createEscapeKeyDown } from "@kobalte/core/primitives/create-escape-key-down"
import { createFocusScope } from "@kobalte/core/primitives/create-focus-scope"
import { createInteractOutside } from "@kobalte/core/primitives/create-interact-outside"
import type { Accessor, JSX } from "solid-js"

export interface DismissableLayerV2HooksProps {
  active: boolean
  onDismiss: () => void
  excludedElements?: () => (Element | undefined)[]
  element: Accessor<HTMLDivElement | undefined>
}

export function DismissableLayerV2Hooks(props: DismissableLayerV2HooksProps): JSX.Element {
  createInteractOutside(
    {
      isDisabled: () => !props.active,
      shouldExcludeElement: (element) => props.excludedElements?.().some((node) => node?.contains(element)) ?? false,
      onPointerDownOutside: (event) => {
        if (!event.defaultPrevented) props.onDismiss()
      },
      onFocusOutside: (event) => {
        if (!event.defaultPrevented) props.onDismiss()
      },
    },
    props.element,
  )

  createEscapeKeyDown({
    isDisabled: () => !props.active,
    onEscapeKeyDown: (event) => {
      event.preventDefault()
      props.onDismiss()
    },
  })

  createFocusScope({ trapFocus: false }, () => (props.active ? props.element() : undefined))

  return null
}
