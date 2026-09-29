import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
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

function ReactGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.25" stroke="currentColor" />
      <circle cx="6" cy="6.75" r="0.75" fill="currentColor" />
      <circle cx="10" cy="6.75" r="0.75" fill="currentColor" />
      <path
        d="M5.5 10.25C6.2 11 7 11.375 8 11.375C9 11.375 9.8 11 10.5 10.25"
        stroke="currentColor"
        stroke-linecap="round"
      />
    </svg>
  );
}

function ReplyGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M6.75 3.5L3.25 7L6.75 10.5"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M3.25 7H9.75C11.7163 7 13.25 8.5337 13.25 10.5V12.5"
        stroke="currentColor"
        stroke-linecap="round"
      />
    </svg>
  );
}

function CopyGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="5.75" y="5.75" width="8.5" height="8.5" rx="1.75" stroke="currentColor" />
      <path
        d="M10.25 3.5H4.25C3.00736 3.5 2 4.50736 2 5.75V10.25"
        stroke="currentColor"
        stroke-linecap="round"
      />
    </svg>
  );
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
            icon={<ReactGlyph />}
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
            icon={<ReplyGlyph />}
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
            icon={<CopyGlyph />}
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
