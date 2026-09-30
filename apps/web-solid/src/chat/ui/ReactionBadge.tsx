import { For, Show } from "solid-js"
import { cn } from "../../lib/cn"
import { Emoji } from "../../lib/emoji"
import type { Reaction } from "../../lib/types"
import { BubbleReactions } from "./bubble"

export interface ReactionStackProps {
  /** One chip per entry. Absent or empty renders nothing at all. */
  reactions: Reaction[] | undefined
  /** Decides which edge of the bubble the row hangs off. */
  side: "user" | "bot"
  onToggle?: (emoji: string) => void
  class?: string
}

/**
 * The chip cluster that hangs off a bubble's corner.
 *
 * Every emoji is its own chip with its own count, so reacting with a second one
 * adds to the row rather than replacing it - and each chip is independent, which
 * is why this maps over the array instead of keeping a single slot.
 *
 * `BubbleReactions` owns where the row sits; this owns the chips inside it.
 * They are kat circles - 28px, a `--bg-subtle` fill and a 2px ring in the
 * transcript background rather than a border - and the corner is the side
 * facing the other speaker, so the row never lands in the column gutter.
 *
 * Nothing renders when a message carries no reactions. That is deliberate: an
 * empty absolutely-positioned wrapper would still be in the DOM on every row in
 * the transcript, and `heights.ts` only reserves the constant padding.
 *
 * There is no transition. The press is instant; a chip that springs back reads
 * as a bounce rather than a tap.
 */
export function ReactionStack(props: ReactionStackProps) {
  return (
    <Show when={(props.reactions?.length ?? 0) > 0}>
      <BubbleReactions
        side="top"
        align={props.side === "user" ? "start" : "end"}
        class={cn("gap-1", props.class)}
        data-component="chat-reaction"
        data-sender={props.side}
      >
        <For each={props.reactions}>
          {(reaction) => (
            <button
              class={cn(
                "pointer-events-auto relative inline-flex h-7 min-w-7 items-center justify-center rounded-full p-0 text-[15px] leading-none",
                "bg-bg-subtle text-text shadow-[0_0_0_2px_var(--bg)]",
                "active:scale-[0.85]",
                // kat's counted circle: 7px of lead-in, 8px of trail.
                reaction.count > 1 && "pr-2 pl-[7px]",
                reaction.viewerReacted
                  ? // The viewer's own reaction takes their own bubble colour.
                    "bg-message-user text-message-user-text hover:bg-message-user"
                  : "hover:bg-bg focus-visible:bg-bg",
              )}
              data-component="chat-reaction-badge"
              data-emoji={reaction.emoji}
              data-count={reaction.count}
              aria-pressed={reaction.viewerReacted}
              aria-label={`${reaction.emoji} ${reaction.count}`}
              onClick={props.onToggle && (() => props.onToggle!(reaction.emoji))}
            >
              <Emoji emoji={reaction.emoji} class="size-[18px] align-middle" eager />
              <Show when={reaction.count > 1}>
                <span class="pl-[2px] text-xs font-medium tabular-nums">{reaction.count}</span>
              </Show>
            </button>
          )}
        </For>
      </BubbleReactions>
    </Show>
  )
}
