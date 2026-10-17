import { Popover } from "@kobalte/core/popover"
import { splitProps, type ComponentProps } from "solid-js"
import "./popover-v2.css"

/**
 * A popover SHELL: Kobalte's Popover with the stacking, the skin and the viewport rules filled in.
 *
 * It is not modal. The page behind stays live, an outside press or Escape closes it, and a dialog
 * opened over it takes the focus and the dismiss without closing it. The caller owns the content
 * and the anchor, so a panel can follow a button that is replaced while it is open.
 *
 * It stays whole inside the window: it flips to a side that fits, slides along that side, and its
 * `--kb-popper-content-available-*` variables carry the room that is left, for the caller's
 * `width: min(32rem, var(--kb-popper-content-available-width))`.
 *
 * Unlike the menu and the hover card it is not in `overlays-impl.ts`: its one caller is already a
 * lazy chunk, so the overlays chunk that every session loads does not carry it.
 */

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
  return <Popover.Content {...r} data-component="popover-v2-content" classList={{ ...s.classList, [s.class ?? ""]: !!s.class }} />
}

export const PopoverV2 = Object.assign(PopoverV2Root, {
  Trigger: Popover.Trigger,
  Anchor: Popover.Anchor,
  Content: PopoverV2Content,
  Portal: Popover.Portal,
  Title: Popover.Title,
  CloseButton: Popover.CloseButton,
})
