import type { JSX } from "solid-js"

/**
 * The two-line type face the v2 token set asks for. `text-[11px]` rather than
 * `text-xs` because the v2 card sets its own 12px leading — the ladder's 1.45
 * is the transcript's, not this card's — and `slnt 0` because the sans stack
 * is variable and its slant axis must not follow the inherited style.
 */
const CARD_TYPE = "text-[11px] leading-3 tracking-[0.05px] [font-variation-settings:'slnt'_0]"

/**
 * Shared 160px two-line card used by v2 file and comment attachments in the
 * composer and timeline.
 *
 * Every state the old stylesheet expressed as a `[data-*]` block is a utility on
 * the element instead: `data-[wide]` drops the fixed measure, `data-[surface]`
 * picks the base fill, `data-[active]` swaps the inset hairline for the strong
 * one, and `data-[clickable]` is the pointer. The two child slots are styled
 * from the card with an arbitrary variant, so a consumer that renders a slot of
 * its own still lands on the card's type.
 */
export function AttachmentCardV2(props: {
  title: string
  active?: boolean
  clickable?: boolean
  wide?: boolean
  surface?: "base"
  /** native title attribute */
  hover?: string
  titleRef?: (element: HTMLSpanElement) => void
  onClick?: () => void
  children: JSX.Element
}) {
  return (
    <div
      data-component="attachment-card-v2"
      data-active={props.active ? "true" : undefined}
      data-clickable={props.clickable ? "true" : undefined}
      data-wide={props.wide ? "true" : undefined}
      data-surface={props.surface}
      title={props.hover}
      onClick={() => props.onClick?.()}
      class={[
        "flex w-40 min-w-40 max-w-40 flex-col gap-1.5 rounded-[6px] p-2 font-sans",
        "bg-v2-overlay-simple-overlay-hover",
        "shadow-[inset_0_0_0_0.5px_var(--v2-border-border-base)]",
        "cursor-default data-[clickable]:cursor-pointer",
        // A wide card is the full measure of its container, so the fixed 160px
        // and both clamps have to go or it cannot grow.
        "data-[wide]:w-full data-[wide]:min-w-0 data-[wide]:max-w-none",
        "data-[surface=base]:bg-v2-background-bg-base",
        "data-[active]:shadow-[inset_0_0_0_0.5px_var(--v2-border-border-strong)]",
        "[&>[data-slot=attachment-card-v2-title]]:w-full [&>[data-slot=attachment-card-v2-title]]:min-w-0",
        "[&>[data-slot=attachment-card-v2-title]]:max-w-full [&>[data-slot=attachment-card-v2-title]]:truncate",
        "[&>[data-slot=attachment-card-v2-title]]:font-[530]",
        "[&>[data-slot=attachment-card-v2-title]]:text-v2-text-text-base",
        "[&>[data-slot=attachment-card-v2-subtitle]]:flex [&>[data-slot=attachment-card-v2-subtitle]]:min-w-0",
        "[&>[data-slot=attachment-card-v2-subtitle]]:items-center [&>[data-slot=attachment-card-v2-subtitle]]:gap-1",
        "[&>[data-slot=attachment-card-v2-subtitle]]:overflow-hidden [&>[data-slot=attachment-card-v2-subtitle]]:whitespace-nowrap",
        "[&>[data-slot=attachment-card-v2-subtitle]]:font-[440]",
        "[&>[data-slot=attachment-card-v2-subtitle]]:text-v2-text-text-muted",
        // The icon rides in the subtitle, so it inherits the slot's 11px and
        // needs its own 12px box or the row's leading grows.
        "[&>[data-slot=attachment-card-v2-subtitle]>[data-component=file-icon]]:size-3",
        "[&>[data-slot=attachment-card-v2-subtitle]>[data-component=file-icon]]:flex-none",
        CARD_TYPE,
      ].join(" ")}
    >
      <span
        ref={(element) => props.titleRef?.(element)}
        data-slot="attachment-card-v2-title"
      >
        {props.title}
      </span>
      <span data-slot="attachment-card-v2-subtitle">{props.children}</span>
    </div>
  )
}
