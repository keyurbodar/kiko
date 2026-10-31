import { For, Show } from "solid-js"
import { cn } from "../../lib/cn"
import type { Reaction } from "../../lib/types"
import { BubbleReactions } from "./bubble"

export interface ReactionStackProps {
  reactions: Reaction[] | undefined
  side: "user" | "bot"
  onToggle?: (emoji: string) => void
  class?: string
}

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
                "pointer-events-auto relative inline-flex h-control-md min-w-control-md items-center justify-center rounded-full p-0 leading-none",
                "bg-elevated text-primary shadow-[0_0_0_2px_var(--bg-chrome),var(--hairline)]",
                "transition-[background-color,transform] duration-(--duration-fast) active:scale-(--press-scale)",
                reaction.count > 1 && "px-1.5",
                reaction.viewerReacted
                  ? "z-[1] bg-[var(--bg-tertiary-opaque-elevated)] shadow-[0_0_0_2px_var(--bg-chrome),inset_0_0_0_1px_var(--stroke-accent)]"
                  : "hover:bg-[var(--bg-quaternary-opaque-elevated)] focus-visible:bg-[var(--bg-quaternary-opaque-elevated)]",
              )}
              data-component="chat-reaction-badge"
              data-emoji={reaction.emoji}
              data-count={reaction.count}
              aria-pressed={reaction.viewerReacted}
              aria-label={`${reaction.emoji} ${reaction.count}`}
              onClick={props.onToggle && (() => props.onToggle!(reaction.emoji))}
            >
              <span class="font-emoji text-[14px] leading-none">{reaction.emoji}</span>
              <Show when={reaction.count > 1}>
                <span class="ml-1 type-xs text-secondary tabular-nums">{reaction.count}</span>
              </Show>
            </button>
          )}
        </For>
      </BubbleReactions>
    </Show>
  )
}
