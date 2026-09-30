import { Show } from "solid-js"
import type { ChatMessage } from "../../lib/types"
import { replyQuoteText } from "../lib/reply"

/**
 * The reply preview, rendered as the FIRST CHILD of the bubble it belongs to.
 * The radius is the bubble's radius minus the bubble's own vertical padding, so
 * the slab reads as part of the bubble rather than a box floating beside it.
 *
 * Nothing is stored here: the message keeps the parent's id and the full body,
 * and the two-line clamp is CSS (`-webkit-line-clamp`). Only the click needs the
 * id, and only to hand it back to the transcript to jump to.
 */
export function Quote(props: {
  parent: ChatMessage
  label: string
  imageUrl?: string
  onOpenReplyTarget: (messageId: string) => void
}) {
  return (
    <button
      type="button"
      class="chat-quote"
      data-component="chat-quote"
      onClick={() => props.onOpenReplyTarget(props.parent.id)}
    >
      <Show when={props.imageUrl}>
        {(src) => (
          <img class="chat-quote__thumb" src={src()} alt="" loading="lazy" decoding="async" />
        )}
      </Show>
      <span class="chat-quote__body">
        <span class="chat-quote__label">{props.label}</span>
        <span class="chat-quote__text">{replyQuoteText(props.parent.body)}</span>
      </span>
    </button>
  )
}
