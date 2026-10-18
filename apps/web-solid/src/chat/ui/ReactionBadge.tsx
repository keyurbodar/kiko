import { createEffect, For, Show } from "solid-js"
import { cn } from "../../lib/cn"
import type { Reaction } from "../../lib/types"
import { BubbleReactions } from "./bubble"

export interface ReactionStackProps {
  messageId: string
  reactions: Reaction[] | undefined
  side: "user" | "bot"
  onToggle?: (emoji: string) => void
  class?: string
}

/*
 * The reactions each message has shown. The list builds a new row when a reaction changes, so the row
 * cannot remember what it showed: this does. The reactions a message has the first time it is drawn
 * are history; one that arrives after that pops in.
 */
const shown = new Map<string, Set<string>>()

export function ReactionStack(props: ReactionStackProps) {
  const seen = shown.get(props.messageId) ?? new Set(props.reactions?.map((reaction) => reaction.emoji))
  shown.set(props.messageId, seen)
  // A reaction taken back is forgotten, so giving it again pops again.
  createEffect(() => {
    const now = new Set(props.reactions?.map((reaction) => reaction.emoji))
    for (const emoji of seen) if (!now.has(emoji)) seen.delete(emoji)
  })
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
          {(reaction) => {
            const fresh = !seen.has(reaction.emoji)
            seen.add(reaction.emoji)
            return (
              <button
                class={cn("reaction-badge", fresh && "motion-reaction-pop")}
                data-component="chat-reaction-badge"
                data-emoji={reaction.emoji}
                data-count={reaction.count}
                aria-pressed={reaction.viewerReacted}
                aria-label={`${reaction.emoji} ${reaction.count}`}
                onClick={props.onToggle && (() => props.onToggle!(reaction.emoji))}
              >
                <span class="reaction-emoji">{reaction.emoji}</span>
                <Show when={reaction.count > 1}>
                  <span class="reaction-count">{reaction.count}</span>
                </Show>
              </button>
            )
          }}
        </For>
      </BubbleReactions>
    </Show>
  )
}
