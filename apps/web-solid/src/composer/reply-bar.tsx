import { RemixIcon } from "@kiko/ui/remix-icon"
import { CloseIcon } from "@kiko/ui/icons"
import { Show, type JSX } from "solid-js"
import type { ReplySummary } from "../chat/lib/reply"
import { EntryIcon } from "../lib/EntryIcon"

export interface ReplyBarProps {
  summary: ReplySummary
  label: string
  onJump: () => void
  onDismiss: () => void
}

export function ReplyBar(props: ReplyBarProps): JSX.Element {
  return (
    <div class="reply-bar" data-component="composer-reply-bar" role="group" aria-label={props.label}>
      <button
        class="reply-bar-jump"
        type="button"
        aria-label={`${props.label}. Go to the message`}
        onClick={() => props.onJump()}
      >
        <Show
          when={props.summary.thumb}
          fallback={<Show when={props.summary.glyph}>{(name) => <EntryIcon path={name()} />}</Show>}
        >
          {(thumb) => <img class="reply-bar-thumb" src={thumb()} alt="" />}
        </Show>
        <span class="reply-bar-text">
          <span class="reply-bar-role">{props.label}</span>
          <span class="reply-bar-preview">{props.summary.text}</span>
        </span>
      </button>
      <button
        class="reply-bar-dismiss"
        type="button"
        aria-label="Cancel reply"
        title="Cancel reply (Esc)"
        onClick={() => props.onDismiss()}
      >
        <RemixIcon icon={CloseIcon} class="size-4" />
      </button>
    </div>
  )
}
