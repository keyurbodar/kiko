import { For, Show, createSignal, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { EmojiText } from "../../lib/emoji"
import type { WebPagePreview } from "../../lib/types"
import { richTextSegments } from "../lib/richtext/segments"
import { SuspiciousLinkDialog } from "./SuspiciousLinkDialog"
import { WebPageCard } from "./WebPageCard"

/**
 * A message body, with the runs inside it drawn as what they are.
 *
 * The runs come from `richTextSegments`, which is a port of tweb's own parser
 * rather than a linkifier: it knows a url from an email from a mention from a
 * hashtag, it gates a scheme-less `foo.com` on a real TLD so `foo.bar` stays
 * prose, and it trims the sentence furniture — a trailing full stop, comma or
 * unbalanced bracket — off the end of a url. `linkifyjs` used to own that, and
 * it is gone: a dependency that answered one question is a dependency worth
 * replacing with the answer.
 *
 * The body is a `<span>`, not a `<div>`, and it carries `chat-text` plus
 * `whitespace-pre-wrap wrap-anywhere`: the pre-wrap is what keeps a sender's
 * own line breaks, and `wrap-anywhere` is what keeps an unbroken url from
 * widening the bubble past its 80% cap.
 *
 * A mention and a hashtag are drawn as prose with a little more weight, never
 * as anchors. They are text the sender typed, and an underlined word that
 * cannot be clicked is a worse lie than no underline at all; the weight is the
 * whole difference.
 *
 * A suspicious url — a host written in mixed scripts, which is how a look-alike
 * is spelled — keeps its text and loses its `href`, so the only way through is
 * the confirm in `SuspiciousLinkDialog`. Dropping the href rather than merely
 * intercepting the click is deliberate: it takes the middle-click and the
 * keyboard with it, and those are the paths an interception misses.
 */
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
                    // A mention or a hashtag is still the sender's own prose, so
                    // it goes through the emoji renderer like any other run —
                    // it just carries more weight than the words around it. A
                    // mention cannot contain emoji artwork, but keeping the one
                    // path means a body with `@name 😀` renders both the same
                    // way it would anywhere else.
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
                      <a
                        class="cursor-pointer text-inherit underline underline-offset-2"
                        role="link"
                        tabindex="0"
                        data-component="chat-masked-link"
                        onClick={(event) => {
                          event.preventDefault()
                          setMaskedHref(href())
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return
                          event.preventDefault()
                          setMaskedHref(href())
                        }}
                      >
                        {segment.text}
                      </a>
                    </Show>
                  )}
                </Show>
              )}
            </For>
          </span>
        )}
      </Show>
      <Show when={props.webPage}>{(page) => <WebPageCard page={page()} />}</Show>
      <Show when={maskedHref()}>
        {(href) => (
          <SuspiciousLinkDialog href={href()} onClose={() => setMaskedHref(null)} />
        )}
      </Show>
    </>
  )
}
