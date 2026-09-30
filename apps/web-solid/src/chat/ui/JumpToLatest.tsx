import { Show } from "solid-js"
import { Icon } from "@kiko/ui/v2/icon"
import { cn } from "../../lib/cn"

/**
 * The pill that appears when the reader has scrolled up and the thread keeps
 * moving. It carries the count of arrivals so they know how much they are
 * about to skip, and it lives in the stage — an absolutely positioned overlay
 * above the scroller — so it does not scroll away with the content.
 *
 * `visible` is the parent's read of the scroll position. The pill is always in
 * the DOM and toggled by `data-visible` on the button: it is `hidden` until
 * then, and there is nothing to animate between the two states anyway.
 */
export function JumpToLatest(props: {
  /** How many rows arrived while the reader was away from the bottom. */
  arrivals: number
  /** False while the reader is parked anywhere but the end of the thread. */
  visible: boolean
  onJump: () => void
  class?: string
}) {
  const label = () =>
    props.arrivals > 0
      ? `${props.arrivals} new message${props.arrivals === 1 ? "" : "s"}`
      : "jump to latest"

  return (
    <div
      class={cn(
        // `chat-jump-latest` is a QA handle, not a style: the verify skill
        // scopes the pill by `.chat-jump-latest > button`.
        "chat-jump-latest pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center",
        props.class,
      )}
      data-component="chat-jump-latest"
    >
      {/*
        Hand-rolled rather than `ButtonV2`: the ghost variant's own `height`,
        `padding` and `border-radius` are set at a specificity a utility on the
        same element cannot beat, so the pill's 16px round on a 32px box would
        have to be fought for. This is one button with one click handler.
      */}
      <button
        type="button"
        class={cn(
          "chat-jump pointer-events-auto hidden items-center gap-1.5 min-h-8 px-3.5 py-1.5",
          "rounded-2xl bg-surface-raised text-text text-sm font-medium lowercase shadow-popover cursor-pointer",
          "data-[visible]:inline-flex hover:bg-btn-hover",
        )}
        data-part="pill"
        data-component="chat-jump"
        data-visible={props.visible ? "" : undefined}
        data-arrivals={String(props.arrivals)}
        aria-label={props.arrivals > 0 ? `${label()}, jump to the end of the thread` : label()}
        onClick={props.onJump}
      >
        <Icon name="chevron-down" size="small" />
        <Show when={props.arrivals > 0} fallback={<span>{"jump to latest"}</span>}>
          <span>{label()}</span>
        </Show>
      </button>
    </div>
  )
}
