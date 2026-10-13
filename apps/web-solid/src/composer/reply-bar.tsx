import { HugeIcon } from "@kiko/ui/huge-icon"
import { Icon as IconV2 } from "@kiko/ui/v2/icon"
import { FileTextIcon } from "@kiko/ui/icons"
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
              <span class="reply-bar-glyph flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                <HugeIcon icon={FileTextIcon} class="size-4" />
              </span>
            </Show>
          }
        >
          {(thumb) => (
            <img
              class="reply-bar-thumb size-8 shrink-0 rounded-[4px] object-cover"
              src={thumb()}
              alt=""
            />
          )}
        </Show>
        <div class="reply-bar-text">
          <span class="reply-bar-role">{props.role}</span>
          <span class="reply-bar-preview">{props.summary.text}</span>
        </div>
      </button>
      <button
        class="reply-bar-dismiss"
        type="button"
        aria-label="Cancel reply"
        onClick={() => props.onDismiss()}
      >
        <IconV2 name="outline-xmark" size="small" />
      </button>
    </div>
  )
}
