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
 * kat's overlapping reaction circles, on the bubble's own corner.
 *
 * Every emoji is its own circle with its own count, so reacting with a second
 * one adds to the cluster rather than replacing it - and each circle is
 * independent, which is why this maps over the array instead of keeping a
 * single slot.
 *
 * The circles OVERLAP by 8px rather than sitting side by side, and each one
 * carries a 2px ring in the transcript background colour. The ring is the whole
 * mechanism: without it an overlap is a smear, because two `--bg-subtle` fills
 * meet with no visible edge. The ring is a `box-shadow`, not a `border` - this
 * repo's `--border` is literally `none`, so a border declaration draws nothing.
 *
 * A circle only becomes a PILL when it carries a count. A count of 1 is a bare
 * 28px circle: a "1" is a number nobody needs, and it is the difference between
 * a cluster and a row of pills.
 *
 * Which corner the cluster lands on, and which way it runs, is
 * `BubbleReactions`' decision - it is keyed on the alignment, because a
 * right-aligned viewer's message and a left-aligned agent's message sit on
 * OPPOSITE corners and have to run in opposite directions. This owns only what
 * is inside the cluster.
 *
 * Nothing renders when a message carries no reactions. That is deliberate: an
 * empty absolutely-positioned wrapper would still be in the DOM on every row in
 * the transcript, and `heights.ts` only reserves the constant padding.
 *
 * There is no transition. The press is instant; a circle that springs back
 * reads as a bounce rather than a tap.
 */
export function ReactionStack(props: ReactionStackProps) {
  return (
    <Show when={(props.reactions?.length ?? 0) > 0}>
      <BubbleReactions
        side="top"
        align={props.side === "user" ? "start" : "end"}
        class={props.class}
        data-component="chat-reaction"
        data-sender={props.side}
      >
        <For each={props.reactions}>
          {(reaction) => (
            <button
              class={cn(
                "pointer-events-auto relative inline-flex h-7 min-w-7 items-center justify-center rounded-full p-0 text-[15px] leading-none",
                "bg-bg-subtle text-text shadow-[0_0_0_2px_var(--bg)]",
                "active:scale-[0.92]",
                // A counted badge has 8px either side. A count of
                // 1 stays a bare circle.
                reaction.count > 1 && "px-2",
                reaction.viewerReacted
                  ? // The viewer's own reaction takes their own bubble colour,
                    // and rides ABOVE its neighbours so the overlap reads.
                    "z-[1] bg-message-user text-message-user-text hover:bg-message-user"
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
                <span class="ml-[3px] text-xs font-medium tabular-nums">{reaction.count}</span>
              </Show>
            </button>
          )}
        </For>
      </BubbleReactions>
    </Show>
  )
}
