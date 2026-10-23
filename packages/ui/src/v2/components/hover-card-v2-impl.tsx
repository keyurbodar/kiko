import { HoverCard } from "@kobalte/core/hover-card"
import { splitProps, type ComponentProps } from "solid-js"
import "./hover-card-v2.css"

const DEFAULT_OPEN_DELAY = 400
const DEFAULT_CLOSE_DELAY = 150

export interface HoverCardV2Props extends ComponentProps<typeof HoverCard> {}

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
