import { For, Show, createSignal, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { EmojiText } from "../../lib/emoji"
import type { WebPagePreview } from "../../lib/types"
import { richTextSegments } from "../lib/richtext/segments"
import { SuspiciousLinkDialog } from "./SuspiciousLinkDialog"
import { WebPageCard } from "./WebPageCard"

export function RichText(props: {
  text?: string
  webPage?: WebPagePreview
  class?: string
}): JSX.Element {
  const [maskedHref, setMaskedHref] = createSignal<string | null>(null)

  return (
    <>
      <Show when={props.text}>
        {(body) => (
          <span class={cn("chat-text whitespace-pre-wrap wrap-anywhere", props.class)}>
            <For each={richTextSegments(body())}>
              {(segment) => (
                <Show
                  when={segment.href}
                  fallback={
                    <Show
                      when={segment.kind === "mention" || segment.kind === "hashtag"}
                      fallback={<EmojiText text={segment.text} />}
                    >
                      <span class="font-medium">{segment.text}</span>
                    </Show>
                  }
                >
                  {(href) => (
                    <Show
                      when={segment.suspicious}
                      fallback={
                        <a
                          class="text-inherit underline underline-offset-2"
                          href={href()}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {segment.text}
                        </a>
                      }
                    >
                      <button
                        type="button"
                        class="cursor-pointer text-inherit underline underline-offset-2"
                        data-component="chat-masked-link"
                        onClick={() => setMaskedHref(href())}
                      >
                        {segment.text}
                      </button>
                    </Show>
                  )}
                </Show>
              )}
            </For>
          </span>
        )}
      </Show>
      <Show when={props.webPage}>{(page) => <WebPageCard page={page()} class="mt-1" />}</Show>
      <Show when={maskedHref()}>
        {(href) => (
          <SuspiciousLinkDialog href={href()} onClose={() => setMaskedHref(null)} />
        )}
      </Show>
    </>
  )
}
