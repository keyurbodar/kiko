import { createSignal, For, onCleanup, Show } from "solid-js";
import { render } from "solid-js/web";
import { Check, Copy, Reply, SmilePlus } from "lucide-solid";
import { IconButtonV2 } from "@kiko/ui/v2/icon-button-v2";
import { MenuV2 } from "@kiko/ui/v2/menu-v2";
import { showToastV2, ToastV2 } from "@kiko/ui/v2/toast-v2";
import type { ChatMessage } from "../../lib/types";
import { EmojiPicker, QUICK_EMOJI } from "./EmojiPicker";

const COPIED_MS = 1000;

let toastRegionMounted = false;

function ensureToastRegion() {
  if (toastRegionMounted) return;
  toastRegionMounted = true;
  render(() => <ToastV2.Region />, document.createElement("div"));
}

export function ActionBar(props: {
  message: ChatMessage;
  onReaction: (messageId: string, emoji: string) => void;
  onReply: (messageId: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [copied, setCopied] = createSignal(false);

  let copiedTimer: number | undefined;
  onCleanup(() => clearTimeout(copiedTimer));

  const hasReaction = QUICK_EMOJI.length > 0;
  const hasReply = typeof props.onReply === "function";
  const hasCopy = props.message.body.trim().length > 0;

  if (!hasReaction && !hasReply && !hasCopy) return null;

  const copy = () => {
    if (copied()) return;
    const fail = () => {
      ensureToastRegion();
      showToastV2({
        title: "Copy failed",
        description: "The message could not be copied.",
        variant: "error",
      });
    };
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      fail();
      return;
    }
    void clipboard.writeText(props.message.body).then(() => {
      setCopied(true);
      clearTimeout(copiedTimer);
      copiedTimer = window.setTimeout(() => setCopied(false), COPIED_MS);
    }, fail);
  };

  return (
    <div
      class="chat-actionbar"
      data-component="chat-actionbar"
      data-open={pickerOpen() ? "true" : undefined}
    >
      <div class="chat-actionbar-panel" data-component="chat-actionbar-panel">
        <For each={QUICK_EMOJI.slice(0, 3)}>
          {(emoji) => (
            <IconButtonV2
              icon={<span class="chat-actionbar-emoji">{emoji}</span>}
              size="normal"
              variant="ghost"
              aria-label={`React with ${emoji}`}
              onClick={() => props.onReaction(props.message.id, emoji)}
            />
          )}
        </For>

        <span
          class="chat-actionbar-divider"
          data-component="chat-actionbar-divider"
          aria-hidden="true"
        />

        <MenuV2
          placement="top-end"
          gutter={8}
          modal={false}
          open={pickerOpen()}
          onOpenChange={setPickerOpen}
        >
          <MenuV2.Trigger
            as={IconButtonV2}
            icon={<SmilePlus size={16} />}
            size="normal"
            variant="ghost"
            aria-label="More reactions"
          />
          <EmojiPicker
            reactions={props.message.reactions ?? []}
            onSelect={(emoji) => props.onReaction(props.message.id, emoji)}
          />
        </MenuV2>

        <Show when={hasReply}>
          <IconButtonV2
            icon={<Reply size={16} />}
            size="normal"
            variant="ghost"
            aria-label="Reply to message"
            onClick={() => props.onReply(props.message.id)}
          />
        </Show>

        <Show when={hasCopy}>
          <IconButtonV2
            icon={copied() ? <Check class="chat-actionbar-check" size={16} /> : <Copy size={16} />}
            size="normal"
            variant="ghost"
            aria-label={copied() ? "Copied" : "Copy message"}
            onClick={copy}
          />
        </Show>
      </div>
    </div>
  );
}
