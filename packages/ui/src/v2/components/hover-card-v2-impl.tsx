import { HoverCard } from "@kobalte/core/hover-card"
import { splitProps, type ComponentProps } from "solid-js"
import "./hover-card-v2.css"

/**
 * A hover card previews what sits behind a pointer, so it must not strobe:
 * opening the instant the cursor grazes a row would flicker the preview on
 * every pass.
 */
const DEFAULT_OPEN_DELAY = 400
const DEFAULT_CLOSE_DELAY = 150

export interface HoverCardV2Props extends ComponentProps<typeof HoverCard> {}

/**
 * `ignoreSafeArea` defaults to TRUE here, against Kobalte's own default.
 *
 * The safe area is the polygon joining the trigger to the card, and while the
 * cursor is anywhere inside it the card stays open. For a preview that is
 * actively harmful: the card is 280px wide and opens to the side of a list, so
 * the polygon covers a large rectangle of the page — walking the pointer down
 * that list leaves the previous card open while the next one opens, and the
 * screen accumulates previews. Verified: with the safe area honoured, hovering
 * two rows in turn left two cards mounted at once.
 *
 * Closing on trigger-leave is also the correct read for a preview: it is
 * something to glance at, not a surface to move into. `hover-card-v2.css` sets
 * `pointer-events: none` on the content for the same reason — a preview that
 * can trap the cursor is a preview that gets stuck.
 */
const DEFAULT_IGNORE_SAFE_AREA = true

function HoverCardV2Root(props: HoverCardV2Props) {
  const [local, others] = splitProps(props, ["openDelay", "closeDelay", "ignoreSafeArea"])
  return (
    <HoverCard
      {...others}
      openDelay={local.openDelay ?? DEFAULT_OPEN_DELAY}
      closeDelay={local.closeDelay ?? DEFAULT_CLOSE_DELAY}
      ignoreSafeArea={local.ignoreSafeArea ?? DEFAULT_IGNORE_SAFE_AREA}
    />
  )
}

export interface HoverCardV2ContentProps extends ComponentProps<typeof HoverCard.Content> {}

function HoverCardV2Content(props: HoverCardV2ContentProps) {
  const [s, r] = splitProps(props, ["class", "classList"])
  return (
    <HoverCard.Content
      {...r}
      data-component="hover-card-v2-content"
      classList={{ ...s.classList, [s.class ?? ""]: !!s.class }}
    />
  )
}

export const HoverCardV2 = Object.assign(HoverCardV2Root, {
  Trigger: HoverCard.Trigger,
  Content: HoverCardV2Content,
  Arrow: HoverCard.Arrow,
  Portal: HoverCard.Portal,
})