import { For, Show, type JSX } from "solid-js";
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
 * The card is placed OUTSIDE the bubble, in `.chat-bubble-below`, so it
 * inherits neither the bubble's padding nor its paint. `data-link-preview`
 * keeps the inline `.chat-bubble a` rule from double-styling it if a card is
 * ever nested. Card chrome is lowercased by CSS; the message body is never
 * transformed.
 */
export function LinkText(props: {
  text?: string;
  preview?: LinkPreview;
}): JSX.Element {
  return (
    <>
      <Show when={props.text}>
        {(body) => (
          <span class="chat-text">
            <For each={linkifySegments(body())}>
              {(segment) => (
                <Show when={segment.href} fallback={<>{segment.text}</>} keyed>
                  {(href) => (
                    <a href={href} target="_blank" rel="noopener noreferrer">
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
          <div class="chat-bubble-below">
            <a
              class="chat-link-card"
              data-link-preview=""
              href={preview().url}
              title={previewHostOf(preview().url)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span class="chat-link-card__title">{preview().title}</span>
              <Show when={preview().description}>
                {(description) => (
                  <span class="chat-link-card__desc">{description()}</span>
                )}
              </Show>
              <Show when={preview().site}>
                {(site) => <span class="chat-link-card__site">{site()}</span>}
              </Show>
            </a>
          </div>
        )}
      </Show>
    </>
  );
}
