import { Show, type JSX } from "solid-js"

const CARD_TYPE = "text-[11px] leading-3 tracking-[0.05px] [font-variation-settings:'slnt'_0]"

const CARD_CLASS = [
  "flex w-40 min-w-40 max-w-40 flex-col gap-1.5 rounded-[6px] p-2 font-sans text-start",
  "bg-v2-overlay-simple-overlay-hover",
  "shadow-[inset_0_0_0_0.5px_var(--v2-border-border-base)]",
  "cursor-default data-[clickable]:cursor-pointer",
  "data-[wide]:w-full data-[wide]:min-w-0 data-[wide]:max-w-none",
  "data-[surface=base]:bg-v2-background-bg-base",
  "data-[active]:shadow-[inset_0_0_0_0.5px_var(--v2-border-border-strong)]",
  "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-v2-border-border-focus",
  "[&>[data-slot=attachment-card-v2-title]]:w-full [&>[data-slot=attachment-card-v2-title]]:min-w-0",
  "[&>[data-slot=attachment-card-v2-title]]:max-w-full [&>[data-slot=attachment-card-v2-title]]:truncate",
  "[&>[data-slot=attachment-card-v2-title]]:font-[530]",
  "[&>[data-slot=attachment-card-v2-title]]:text-v2-text-text-base",
  "[&>[data-slot=attachment-card-v2-subtitle]]:flex [&>[data-slot=attachment-card-v2-subtitle]]:min-w-0",
  "[&>[data-slot=attachment-card-v2-subtitle]]:items-center [&>[data-slot=attachment-card-v2-subtitle]]:gap-1",
  "[&>[data-slot=attachment-card-v2-subtitle]]:overflow-hidden [&>[data-slot=attachment-card-v2-subtitle]]:whitespace-nowrap",
  "[&>[data-slot=attachment-card-v2-subtitle]]:font-[440]",
  "[&>[data-slot=attachment-card-v2-subtitle]]:text-v2-text-text-muted",
  "[&>[data-slot=attachment-card-v2-subtitle]>[data-component=file-icon]]:size-3",
  "[&>[data-slot=attachment-card-v2-subtitle]>[data-component=file-icon]]:flex-none",
  CARD_TYPE,
].join(" ")

export function AttachmentCardV2(props: {
  title: string
  active?: boolean
  clickable?: boolean
  wide?: boolean
  surface?: "base"
  hover?: string
  titleRef?: (element: HTMLSpanElement) => void
  onClick?: () => void
  children: JSX.Element
}) {
  const card = () => ({
    "data-component": "attachment-card-v2",
    "data-active": props.active ? "true" : undefined,
    "data-clickable": props.clickable ? "true" : undefined,
    "data-wide": props.wide ? "true" : undefined,
    "data-surface": props.surface,
  })
  const body = () => (
    <>
      <span ref={(element) => props.titleRef?.(element)} data-slot="attachment-card-v2-title">
        {props.title}
      </span>
      <span data-slot="attachment-card-v2-subtitle">{props.children}</span>
    </>
  )
  return (
    <Show
      when={props.onClick}
      fallback={
        <div {...card()} class={CARD_CLASS} title={props.hover}>
          {body()}
        </div>
      }
    >
      <button type="button" {...card()} class={CARD_CLASS} title={props.hover} onClick={() => props.onClick?.()}>
        {body()}
      </button>
    </Show>
  )
}