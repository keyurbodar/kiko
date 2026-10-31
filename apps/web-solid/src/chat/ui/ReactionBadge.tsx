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
                "text-primary shadow-[0_0_0_2px_var(--bg-chrome)]",
                "transition-[background-color,transform] duration-(--duration-fast) active:scale-(--press-scale)",
                reaction.count > 1 && "px-1.5",
                reaction.viewerReacted
                  ? "z-[1] bg-[color-mix(in_oklab,var(--bg-accent)_22%,var(--bg-chrome))] hover:bg-[color-mix(in_oklab,var(--bg-accent)_30%,var(--bg-chrome))]"
                  : "bg-[var(--bg-tertiary-opaque)] hover:bg-[color-mix(in_oklab,var(--text-primary)_14%,var(--bg-chrome))] focus-visible:bg-[color-mix(in_oklab,var(--text-primary)_14%,var(--bg-chrome))]",
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
                <span
                  class={cn("ml-1 type-xs tabular-nums", reaction.viewerReacted ? "text-accent" : "text-secondary")}
                >
                  {reaction.count}
                </span>
              </Show>
            </button>
          )}
        </For>
      </BubbleReactions>
    </Show>
  )
}
