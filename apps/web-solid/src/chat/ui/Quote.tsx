import { Show } from "solid-js"
import { cn } from "../../lib/cn"
import type { ChatMessage } from "../../lib/types"
import { replyQuoteText } from "../lib/reply"

/**
 * The reply preview, rendered as the FIRST CHILD of the bubble it belongs to.
 * The radius is the bubble's radius minus the bubble's own vertical padding, so
 * the slab reads as part of the bubble rather than a box floating beside it.
 *
 * Nothing is stored here: the message keeps the parent's id and the full body,
 * and the clamps are the `line-clamp` utilities on the label and the text. Only
 * the click needs the id, and only to hand it back to the transcript to jump to.
 *
 * The tint is derived from `currentColor` rather than a token, so the slab
 * follows whichever of the two message colours the bubble it sits in already
 * painted. A parent that carries an image quotes as a ROW instead of a column:
 * the thumbnail takes its 32px, and the body takes what is left of the line.
 */
export function Quote(props: {
  parent: ChatMessage
  label: string
  imageUrl?: string
  onOpenReplyTarget: (messageId: string) => void
  class?: string
}) {
  return (
    <button
      type="button"
      data-component="chat-quote"
      class={cn(
        "relative flex w-full cursor-pointer flex-col gap-px overflow-hidden",
        "mb-1 p-[5px_8px_5px_11px] text-start text-inherit text-sm leading-[1.35]",
        "rounded-[calc(var(--radius-bubble)-7px)] bg-[oklch(from_currentColor_l_c_h/10%)]",
        // The 3px rule down the sender's edge.
        "[&::before]:absolute [&::before]:inset-y-0 [&::before]:start-0 [&::before]:w-[3px]",
        "[&::before]:bg-[oklch(from_currentColor_l_c_h/35%)] [&::before]:content-['']",
        // An image parent lays the quote out as a row: thumb inline-start, text
        // taking the rest of the line.
        "has-[img]:flex-row has-[img]:items-center has-[img]:gap-2 has-[img]:[&>:last-child]:flex-1",
        props.class,
      )}
      onClick={() => props.onOpenReplyTarget(props.parent.id)}
    >
      <Show when={props.imageUrl}>
        {(src) => (
          <img
            class="chat-quote__thumb size-8 shrink-0 grow-0 basis-8 rounded-[2px] object-cover"
            src={src()}
            alt=""
            loading="lazy"
            decoding="async"
          />
        )}
      </Show>
      <span class="chat-quote__body flex min-w-0 flex-col gap-px">
        <span class="chat-quote__label min-w-full max-w-[221px] truncate font-[var(--font-weight-bold)] opacity-90">
          {props.label}
        </span>
        <span class="chat-quote__text line-clamp-2 min-w-full max-w-[221px] wrap-anywhere opacity-75">
          {replyQuoteText(props.parent.body)}
        </span>
      </span>
    </button>
  )
}
