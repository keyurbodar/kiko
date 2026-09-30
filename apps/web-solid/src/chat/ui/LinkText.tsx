import { For, Show, type JSX } from "solid-js";
import { EmojiText } from "../../lib/emoji";
import { cn } from "../../lib/cn";
import { linkifySegments, previewHostOf } from "../lib/linkify";

/**
 * Metadata for the card that hangs below a bubble that points at a page. It
 * mirrors `ChatMessage["linkPreview"]`, so a message carries its own card
 * without the renderer having to derive anything from the body.
 */
export type LinkPreview = {
  url: string;
  title: string;
  description?: string;
  site?: string;
};

/**
 * Message text with every URL run wrapped in an anchor that inherits the
 * bubble's own colour, plus the optional preview card.
 *
 * Both parts go inside `BubbleContent`, so the card takes the bubble's padding
 * and sits in the bubble's colour rather than reading as a detached panel.
 * `data-link-preview` is what keeps an inline link rule on the bubble content
 * from double-styling the card.
 *
 * The two pieces are independent: `class` lands on the body text, which is the
 * surface a caller sizing the message actually wants, and the card keeps its
 * own chrome. Only the card is lowercased — a URL preview is chrome, and the
 * message body above it is never transformed.
 */
export function LinkText(props: {
  text?: string;
  preview?: LinkPreview;
  class?: string;
}): JSX.Element {
  return (
    <>
      <Show when={props.text}>
        {(body) => (
          <span class={cn("chat-text whitespace-pre-wrap wrap-anywhere", props.class)}>
            <For each={linkifySegments(body())}>
              {(segment) => (
                <Show
                  when={segment.href}
                  fallback={<EmojiText text={segment.text} />}
                  keyed
                >
                  {(href) => (
                    <a
                      class="text-inherit underline underline-offset-2"
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {segment.text}
                    </a>
                  )}
                </Show>
              )}
            </For>
          </span>
        )}
      </Show>
      <Show when={props.preview}>
        {(preview) => (
          <div class="mt-0.5">
            <a
              class={cn(
                "chat-link-card box-border flex w-80 max-w-full flex-col items-start gap-1",
                "rounded-[calc(16px*var(--brm))] [corner-shape:squircle] bg-surface-raised p-3",
                "text-text no-underline lowercase",
                "shadow-[0_2px_6px_oklch(from_var(--text)_l_c_h/5%)]",
                // A bare transform, no transition: the card presses and comes back.
                "active:scale-[0.985] focus-visible:outline-offset-[-3px]",
              )}
              data-link-preview=""
              href={preview().url}
              title={previewHostOf(preview().url)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span class="line-clamp-2 text-sm font-medium">{preview().title}</span>
              <Show when={preview().description}>
                {(description) => (
                  <span class="line-clamp-2 text-sm text-weak">{description()}</span>
                )}
              </Show>
              <Show when={preview().site}>
                {(site) => <span class="max-w-full truncate text-xs font-medium text-weak">{site()}</span>}
              </Show>
            </a>
          </div>
        )}
      </Show>
    </>
  );
}
