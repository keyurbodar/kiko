import { HugeIcon } from "@kiko/ui/huge-icon"
import { Show, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import type { ChatMessage } from "../../lib/types"
import type { ReplySummary } from "../lib/reply"

export function Quote(props: {
  parent: ChatMessage
  label: string
  summary: ReplySummary
  side?: "user" | "bot"
  /** The quoted author's colour in a group: it tints the name, the bar, and the background. */
  tint?: string
  onOpenReplyTarget: (messageId: string) => void
  class?: string
}) {
  const tone = (): JSX.CSSProperties =>
    props.tint
      ? {
          "--quote-bg": `color-mix(in oklch, ${props.tint} 14%, transparent)`,
          "--quote-bar": props.tint,
          "--quote-name": props.tint,
        }
      : props.side === "user"
      ? {
          "--quote-bg": "var(--out-quote-bg)",
          "--quote-bar": "var(--out-quote-bar)",
          "--quote-name": "var(--out-quote-name)",
        }
      : {
          "--quote-bg": "var(--in-quote-bg)",
          "--quote-bar": "var(--in-quote-bar)",
          "--quote-name": "var(--in-quote-name)",
        }

  return (
    <button
      type="button"
      data-component="chat-quote"
      style={tone()}
      class={cn(
        "relative flex w-full cursor-pointer flex-row items-center gap-2 overflow-hidden",
        "mb-1 py-[3px] ps-[11px] pe-2 text-start text-inherit text-sm leading-[1.35]",
        "rounded-[4px] bg-[var(--quote-bg)]",
        "before:absolute before:inset-y-0 before:start-0 before:w-[3px] before:bg-[var(--quote-bar)] before:content-['']",
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
                {glyph() === "document" ? <HugeIcon name="file-text" class="size-4" /> : <HugeIcon name="link" class="size-4" />}
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
        <span class="chat-quote__label min-w-0 max-w-[221px] truncate font-semibold text-[var(--quote-name)]">
          {props.label}
        </span>
        <span class="chat-quote__text min-w-0 max-w-[221px] truncate opacity-75">
          {props.summary.text}
        </span>
      </span>
    </button>
  )
}
