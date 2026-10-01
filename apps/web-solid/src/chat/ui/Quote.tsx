import { FileText, Link } from "lucide-solid"
import { Show } from "solid-js"
import { cn } from "../../lib/cn"
import type { ChatMessage } from "../../lib/types"
import type { ReplySummary } from "../lib/reply"

export function Quote(props: {
  parent: ChatMessage
  label: string
  summary: ReplySummary
  side?: "user" | "bot"
  onOpenReplyTarget: (messageId: string) => void
  class?: string
}) {
  return (
    <button
      type="button"
      data-component="chat-quote"
      class={cn(
        "relative flex w-full cursor-pointer flex-row items-center gap-2 overflow-hidden",
        "mb-1 py-[3px] ps-[11px] pe-2 text-start text-inherit text-sm leading-[1.35]",
        "rounded-[4px] bg-[oklch(from_currentColor_l_c_h/10%)]",
        "before:absolute before:inset-y-0 before:start-0 before:w-[3px] before:bg-current before:content-['']",
        props.side === "bot" && "before:bg-accent",
        props.class,
      )}
      onClick={() => props.onOpenReplyTarget(props.parent.id)}
    >
      <Show
        when={props.summary.thumb}
        fallback={
          <Show when={props.summary.glyph}>
            {(glyph) => (
              <span class="chat-quote__thumb flex size-8 shrink-0 items-center justify-center rounded-full bg-[oklch(from_currentColor_l_c_h/15%)]">
                {glyph() === "document" ? <FileText class="size-4" /> : <Link class="size-4" />}
              </span>
            )}
          </Show>
        }
      >
        {(src) => (
          <img
            class="chat-quote__thumb size-8 shrink-0 rounded-[3px] object-cover"
            src={src()}
            alt=""
            loading="lazy"
            decoding="async"
          />
        )}
      </Show>
      <span class="chat-quote__body flex min-w-0 flex-1 flex-col">
        <span
          class={cn(
            "chat-quote__label min-w-0 max-w-[221px] truncate font-semibold",
            props.side === "bot" && "text-accent",
          )}
        >
          {props.label}
        </span>
        <span class="chat-quote__text min-w-0 max-w-[221px] truncate opacity-75">
          {props.summary.text}
        </span>
      </span>
    </button>
  )
}
