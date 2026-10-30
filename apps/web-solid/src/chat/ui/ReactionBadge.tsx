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
                "pointer-events-auto relative inline-flex h-7 min-w-7 items-center justify-center rounded-full p-0 text-[15px] leading-none",
                "bg-panel text-fg shadow-[0_0_0_2px_var(--bg)]",
                "active:scale-[0.92]",
                reaction.count > 1 && "px-2",
                reaction.viewerReacted ? "z-[1] bg-me text-fg hover:bg-me" : "hover:bg-bg focus-visible:bg-bg",
              )}
              data-component="chat-reaction-badge"
              data-emoji={reaction.emoji}
              data-count={reaction.count}
              aria-pressed={reaction.viewerReacted}
              aria-label={`${reaction.emoji} ${reaction.count}`}
              onClick={props.onToggle && (() => props.onToggle!(reaction.emoji))}
            >
              <span class="font-emoji text-[17px] leading-none">{reaction.emoji}</span>
              <Show when={reaction.count > 1}>
                <span class="ml-[3px] text-hint font-medium">{reaction.count}</span>
              </Show>
            </button>
          )}
        </For>
      </BubbleReactions>
    </Show>
  )
}
