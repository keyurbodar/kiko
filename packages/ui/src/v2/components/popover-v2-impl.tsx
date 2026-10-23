import { Popover } from "@kobalte/core/popover"
import { splitProps, type ComponentProps } from "solid-js"
import "./popover-v2.css"

export interface PopoverV2Props extends ComponentProps<typeof Popover> {}

const EDGE = 8
const GAP = 6

function PopoverV2Root(props: PopoverV2Props) {
  const [local, others] = splitProps(props, ["gutter", "overflowPadding", "flip", "fitViewport", "slide", "modal"])
  return (
    <Popover
      {...others}
      modal={local.modal ?? false}
      gutter={local.gutter ?? GAP}
      overflowPadding={local.overflowPadding ?? EDGE}
      flip={local.flip ?? true}
      slide={local.slide ?? true}
      fitViewport={local.fitViewport ?? true}
    />
  )
}

export interface PopoverV2ContentProps extends ComponentProps<typeof Popover.Content> {}

function PopoverV2Content(props: PopoverV2ContentProps) {
  const [s, r] = splitProps(props, ["class", "classList"])
  return (
    <Popover.Content
      {...r}
      data-component="popover-v2-content"
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    />
  )
}

export const PopoverV2 = Object.assign(PopoverV2Root, {
  Trigger: Popover.Trigger,
  Anchor: Popover.Anchor,
  Content: PopoverV2Content,
  Portal: Popover.Portal,
  Title: Popover.Title,
  CloseButton: Popover.CloseButton,
})
