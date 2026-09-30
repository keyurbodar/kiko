import { Show, type JSX } from "solid-js"
import type { ChatMessage } from "../lib/types"

export interface ReplyBarProps {
  /** The message being replied to. */
  message: ChatMessage
  /** Who the quoted message is from, resolved by the caller. */
  role: string
  /** Still for a message that carries media: the first item's frame. */
  thumb?: string
  /** Jump the transcript to the quoted message. */
  onJump: () => void
  /** Drop the reply. */
  onDismiss: () => void
}

/**
 * The quoted message strip that sits inside the composer's input surface,
 * above the input line.
 *
 * Every element is styled by the unlayered composer stylesheet through the
 * FROZEN class names, so nothing here carries a utility: a utility would beat
 * the plain class rules and win the cascade. The whole quoted region is the
 * jump target because a two-line preview is not a reliable click target on its
 * own — the role line and the preview both belong to the jump.
 */
export function ReplyBar(props: ReplyBarProps): JSX.Element {
  return (
    <div class="reply-bar" data-component="composer-reply-bar">
      <button
        class="reply-bar-jump"
        type="button"
        onClick={() => props.onJump()}
      >
        <div class="reply-bar-text">
          <span class="reply-bar-role">{props.role}</span>
          <Show
            when={props.thumb}
            fallback={<span class="reply-bar-preview">{replyPreview(props.message.body)}</span>}
          >
            {(thumb) => (
              <div class="reply-preview-line">
                <img class="attachment-thumb" src={thumb()} alt="" />
                <span class="reply-bar-preview">{replyPreview(props.message.body)}</span>
              </div>
            )}
          </Show>
        </div>
      </button>
      <button
        class="reply-bar-dismiss"
        type="button"
        aria-label="cancel reply"
        onClick={() => props.onDismiss()}
      >
        ×
      </button>
    </div>
  )
}

/**
 * Flattens a message body into one line of preview text.
 *
 * Deliberately does not truncate: the stylesheet clamps the preview to two
 * lines, and cutting here as well would double-cut the text and make a long
 * quote read as if it had been trimmed for a reason the UI never explains.
 */
export function replyPreview(body: string): string {
  return body.replace(/\s+/g, " ").trim()
}
