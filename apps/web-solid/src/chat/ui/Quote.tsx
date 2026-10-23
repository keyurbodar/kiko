import { Show, type JSX } from "solid-js"
import { Dynamic } from "solid-js/web"
import { cn } from "../../lib/cn"
import { EntryIcon } from "../../lib/EntryIcon"
import type { QuoteModel } from "../lib/reply"

export function Quote(props: {
  quote: QuoteModel
  side?: "user" | "bot"
  tint?: string
  onOpenReplyTarget: (messageId: string, seq?: number) => void
  class?: string
}) {
  const summary = () => props.quote.summary
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

  const Box = (): "div" | "button" => (props.quote.gone ? "div" : "button")
  return (
    <Dynamic
      component={Box()}
      {...(props.quote.gone ? {} : { type: "button", "aria-label": `Go to the message from ${props.quote.label}` })}
      data-component="chat-quote"
      data-gone={props.quote.gone ? "" : undefined}
      style={tone()}
      class={cn(
        "relative flex w-full flex-row items-center gap-2 overflow-hidden",
        props.quote.gone ? "cursor-default italic" : "cursor-pointer",
        "mb-1 py-[3px] ps-2.5 pe-2 text-start text-inherit text-sm leading-[1.35]",
        "rounded-[4px] bg-[var(--quote-bg)]",
        "before:absolute before:inset-y-0 before:start-0 before:w-[2px] before:bg-[var(--quote-bar)] before:content-['']",
        props.class,
      )}
      onClick={() => !props.quote.gone && props.onOpenReplyTarget(props.quote.id, props.quote.seq)}
    >
      <Show
        when={summary().thumb}
        fallback={
          <Show when={summary().glyph}>
            {(name) => (
              <span class="chat-quote__thumb flex size-8 shrink-0 items-center justify-center rounded-full bg-[oklch(from_currentColor_l_c_h/15%)]">
                <EntryIcon path={name()} />
              </span>
            )}
          </Show>
        }
      >
        {(src) => (
          <img
            class="chat-quote__thumb size-8 shrink-0 rounded-[4px] object-cover"
            src={src()}
            alt=""
            loading="lazy"
            decoding="async"
          />
        )}
      </Show>
      <span class="chat-quote__body flex min-w-0 flex-1 flex-col">
        <span class="chat-quote__label min-w-0 truncate font-semibold text-[var(--quote-name)]">
          {props.quote.label}
        </span>
        <span class="chat-quote__text min-w-0 truncate opacity-75">{summary().text}</span>
      </span>
    </Dynamic>
  )
}
