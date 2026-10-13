import { FileTextIcon, XIcon } from "lucide-solid"
import { Show, type JSX } from "solid-js"
import type { ReplySummary } from "../chat/lib/reply"

export interface ReplyBarProps {
  summary: ReplySummary
  role: string
  onJump: () => void
  onDismiss: () => void
}

export function ReplyBar(props: ReplyBarProps): JSX.Element {
  return (
    <div class="reply-bar" data-component="composer-reply-bar">
      <button class="reply-bar-jump" type="button" onClick={() => props.onJump()}>
        <Show
          when={props.summary.thumb}
          fallback={
            <Show when={props.summary.glyph}>
              <FileTextIcon size={14} class="reply-bar-glyph" />
            </Show>
          }
        >
          {(thumb) => <img class="reply-bar-thumb" src={thumb()} alt="" />}
        </Show>
        <span class="reply-bar-role">{props.role}</span>
        <span class="reply-bar-preview">{props.summary.text}</span>
      </button>
      <button class="reply-bar-dismiss" type="button" aria-label="Cancel reply" onClick={() => props.onDismiss()}>
        <XIcon class="size-4" aria-hidden="true" />
      </button>
    </div>
  )
}
