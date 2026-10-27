import { Show } from "solid-js"
import { Dynamic } from "solid-js/web"
import { cn } from "../../lib/cn"
import { EntryIcon } from "../../lib/EntryIcon"
import type { QuoteModel } from "../lib/reply"

export function Quote(props: {
  quote: QuoteModel
  onOpenReplyTarget: (messageId: string, seq?: number) => void
  class?: string
}) {
  const summary = () => props.quote.summary
  const Box = (): "div" | "button" => (props.quote.gone ? "div" : "button")
  return (
    <Dynamic
      component={Box()}
      {...(props.quote.gone ? {} : { type: "button", "aria-label": `Go to the message from ${props.quote.label}` })}
      data-component="chat-quote"
      data-gone={props.quote.gone ? "" : undefined}
      class={cn(
        "relative flex w-full flex-row items-center gap-2 overflow-hidden",
        props.quote.gone ? "cursor-default opacity-70" : "cursor-pointer",
        "mb-1 mt-0.5 py-1.5 ps-3.5 pe-3 text-start text-inherit type-label",
        "rounded-row bg-[color-mix(in_oklab,var(--fg)_7%,transparent)] transition-colors duration-[120ms] hover:bg-[color-mix(in_oklab,var(--fg)_11%,transparent)]",
        "before:absolute before:inset-y-2 before:start-2.5 before:w-[2px] before:rounded-full before:bg-[var(--fg4)] before:content-['']",
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
        <span class="chat-quote__label min-w-0 truncate font-semibold text-fg">{props.quote.label}</span>
        <span class="chat-quote__text min-w-0 truncate opacity-75">{summary().text}</span>
      </span>
    </Dynamic>
  )
}
