import { For } from "solid-js";
import { MenuV2 } from "@kiko/ui/v2/menu-v2";
import type { Reaction } from "../../lib/types";
export const QUICK_EMOJI = ["❤️", "🔥", "😂", "👍", "🎉", "👀", "🚀", "✅"] as const;

function viewerReacted(reactions: readonly Reaction[], emoji: string): boolean {
  return reactions.some((reaction) => reaction.emoji === emoji && reaction.viewerReacted);
}

export function EmojiPicker(props: {
  reactions: readonly Reaction[];
  onSelect: (emoji: string) => void;
}) {
  return (
    <MenuV2.Portal>
      <MenuV2.Content class="chat-emoji-menu">
        <div class="chat-emoji-grid" data-component="chat-emoji-grid">
          <MenuV2.RadioGroup aria-label="React to message">
            <For each={QUICK_EMOJI}>
              {(emoji) => (
                <MenuV2.RadioItem
                  value={emoji}
                  aria-label={`React with ${emoji}`}
                  onSelect={() => props.onSelect(emoji)}
                >
                  <span
                    class="chat-emoji"
                    data-component="chat-emoji"
                    data-mine={String(viewerReacted(props.reactions, emoji))}
                  >
                    {emoji}
                  </span>
                </MenuV2.RadioItem>
              )}
            </For>
          </MenuV2.RadioGroup>
        </div>
      </MenuV2.Content>
    </MenuV2.Portal>
  );
}
