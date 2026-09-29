import { createSignal, onMount, type JSX } from "solid-js";
import { ButtonV2 } from "@kiko/ui/v2/button-v2";
import { TextareaV2 } from "@kiko/ui/v2/textarea-v2";

const QUOTE_MAX = 96;

const [openReplyToId, setOpenReplyToId] = createSignal<string | null>(null);

export const replyComposerTarget = openReplyToId;

export function openReplyComposer(messageId: string) {
  setOpenReplyToId(messageId);
}

export function closeReplyComposer(messageId?: string) {
  setOpenReplyToId((current) =>
    messageId === undefined || current === messageId ? null : current,
  );
}

function truncateQuote(quote: string): string {
  const collapsed = quote.replace(/\s+/g, " ").trim();
  return collapsed.length > QUOTE_MAX ? `${collapsed.slice(0, QUOTE_MAX - 1)}…` : collapsed;
}

export function ReplyComposer(props: {
  author: string;
  quote: string;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = createSignal("");
  let textarea: HTMLTextAreaElement | undefined;
  onMount(() => textarea?.focus());

  const send = () => {
    const trimmed = body().trim();
    if (!trimmed) return;
    setBody("");
    props.onSubmit(trimmed);
  };

  const onKeyDown: JSX.EventHandlerUnion<HTMLTextAreaElement, KeyboardEvent> = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      props.onCancel();
    }
  };

  return (
    <div class="chat-reply-composer" data-component="chat-reply-composer">
      <div class="chat-reply-target" data-component="chat-reply-target">
        <span class="chat-reply-target-author" data-component="chat-reply-target-author">
          {props.author}
        </span>
        <span class="chat-reply-target-quote" data-component="chat-reply-target-quote">
          {truncateQuote(props.quote)}
        </span>
      </div>

      <TextareaV2
        rows={2}
        placeholder="Reply…"
        aria-label={`Reply to ${props.author}`}
        value={body()}
        onInput={(event) => setBody(event.currentTarget.value)}
        onKeyDown={onKeyDown}
        ref={(element) => {
          textarea = element;
        }}
      />

      <div class="chat-reply-actions" data-component="chat-reply-actions">
        <ButtonV2 size="small" variant="ghost" onClick={props.onCancel}>
          Cancel
        </ButtonV2>
        <ButtonV2 size="small" variant="neutral" disabled={!body().trim()} onClick={send}>
          Reply
        </ButtonV2>
      </div>
    </div>
  );
}
