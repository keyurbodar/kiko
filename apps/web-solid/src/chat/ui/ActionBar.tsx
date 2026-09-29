import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { Copy, Reply, SmilePlus } from "lucide-solid";
import { IconButtonV2 } from "@kiko/ui/v2/icon-button-v2";
import { MenuV2 } from "@kiko/ui/v2/menu-v2";
import { showToastV2, ToastV2 } from "@kiko/ui/v2/toast-v2";
import type { ChatMessage } from "../../lib/types";
import { EmojiPicker, QUICK_EMOJI } from "./EmojiPicker";

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
  ensureToastRegion();

  const hasReaction = QUICK_EMOJI.length > 0;
  const hasReply = typeof props.onReply === "function";
  const hasCopy = props.message.body.trim().length > 0;

  if (!hasReaction && !hasReply && !hasCopy) return null;

  const copy = () => {
    const body = props.message.body;
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      showToastV2({
        title: "Copy failed",
        description: "The clipboard is unavailable in this context.",
        variant: "error",
      });
      return;
    }
    void clipboard.writeText(body).then(
      () =>
        showToastV2({
          title: "Copied",
          description: "Message copied to clipboard.",
          variant: "success",
        }),
      () =>
        showToastV2({
          title: "Copy failed",
          description: "The message could not be copied.",
          variant: "error",
        }),
    );
  };

  return (
    <div
      class="chat-actionbar"
      data-component="chat-actionbar"
      data-open={pickerOpen() ? "true" : undefined}
    >
      <div class="chat-actionbar-pill" data-component="chat-actionbar-pill">
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
            aria-label="React to message"
          />
          <EmojiPicker
            reactions={props.message.reactions ?? []}
            onSelect={(emoji) => props.onReaction(props.message.id, emoji)}
          />
        </MenuV2>

        <Show when={hasReply}>
          <span
            class="chat-actionbar-divider"
            data-component="chat-actionbar-divider"
            aria-hidden="true"
          />
          <IconButtonV2
            icon={<Reply size={16} />}
            size="normal"
            variant="ghost"
            aria-label="Reply to message"
            onClick={() => props.onReply(props.message.id)}
          />
        </Show>

        <Show when={hasCopy}>
          <span
            class="chat-actionbar-divider"
            data-component="chat-actionbar-divider"
            aria-hidden="true"
          />
          <IconButtonV2
            icon={<Copy size={16} />}
            size="normal"
            variant="ghost"
            aria-label="Copy message"
            onClick={copy}
          />
        </Show>
      </div>
    </div>
  );
}
