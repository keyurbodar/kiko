import { For, Show } from "solid-js"
import type { Reaction } from "../../lib/types"
import "../interactions.css"

export interface ReactionStackProps {
  reactions: readonly Reaction[]
  /** Decides which corner the badges hang off and where they are pinned. */
  side: "user" | "bot"
  onToggle?: (emoji: string) => void
  class?: string
}

/**
 * The badges that hang off a bubble's top corner. They overlap each other by
 * 8px and take their 2px ring from a `box-shadow` in the page background, so
 * the stack reads as one cluster sitting on the transcript rather than a
 * bordered tray of chips.
 */
export function ReactionStack(props: ReactionStackProps) {
  return (
    <Show when={props.reactions.length > 0}>
      <div
        class={`chat-reaction-stack ${props.class ?? ""}`}
        data-component="chat-reaction-stack"
        data-side={props.side}
      >
        <For each={props.reactions}>
          {(reaction) => (
            <button
              type="button"
              class="chat-reaction-badge"
              classList={{ "chat-reaction-badge--own": reaction.viewerReacted }}
              data-component="chat-reaction-badge"
              data-emoji={reaction.emoji}
              data-count={reaction.count}
              aria-pressed={reaction.viewerReacted}
              aria-label={`${reaction.emoji} ${reaction.count}`}
              onClick={props.onToggle && (() => props.onToggle!(reaction.emoji))}
            >
              <span class="chat-reaction-badge__emoji">{reaction.emoji}</span>
              <Show when={reaction.count > 1}>
                <span class="chat-reaction-badge__count">{reaction.count}</span>
              </Show>
            </button>
          )}
        </For>
      </div>
    </Show>
  )
}
