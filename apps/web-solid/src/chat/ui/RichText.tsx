import { For, Match, Show, Suspense, Switch, createSignal, lazy, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { EmojiText } from "../../lib/emoji"
import { richTextSegments } from "../lib/richtext/segments"
import { Mention } from "./Mention"

/* The warning for a masked link loads on the click that needs it. */
const SuspiciousLinkDialog = lazy(() => import("./SuspiciousLinkDialog").then((m) => ({ default: m.SuspiciousLinkDialog })))

export function RichText(props: {
  text?: string
  class?: string
}): JSX.Element {
  const [maskedHref, setMaskedHref] = createSignal<string | null>(null)

  return (
    <>
      <Show when={props.text}>
        {(body) => (
          <span class={cn("bubble-text whitespace-pre-wrap wrap-anywhere", props.class)}>
            <For each={richTextSegments(body())}>
              {(segment) => (
                <Show
                  when={segment.href}
                  fallback={
                    <Switch fallback={<EmojiText text={segment.text} />}>
                      <Match when={segment.kind === "mention"}>
                        <Mention slug={segment.text.slice(1).toLowerCase()} text={segment.text} />
                      </Match>
                      <Match when={segment.kind === "hashtag"}>
                        <span class="font-medium">{segment.text}</span>
                      </Match>
                    </Switch>
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
      <Show when={maskedHref()}>
        {(href) => (
          <Suspense>
            <SuspiciousLinkDialog href={href()} onClose={() => setMaskedHref(null)} />
          </Suspense>
        )}
      </Show>
    </>
  )
}
