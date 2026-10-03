import { Show, createMemo, createSignal, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { colorOfImage } from "../lib/cardColor"
import { CARD_IMAGE_ASPECT, CARD_WIDTH, cardColor, hasCardColor, hasWebPageContent, ownMedia, rememberCardColor } from "../lib/linkPreview"
import type { WebPagePreview } from "../../lib/types"

const TITLE_LENGTH = 80
const TITLE_LIMIT = 100
const DESCRIPTION_LENGTH = 150
const DESCRIPTION_LIMIT = 180

function limitSymbols(value: string | undefined, length: number, limitFrom: number): string {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > limitFrom ? `${trimmed.slice(0, length)}...` : trimmed
}

/**
 * The kat link card: the picture on top, then a panel in the page's own colour with the host,
 * the title, and two lines of text in white. The colour comes from the picture (see
 * `cardColor.ts`); until it is known the panel takes the page's theme-color or the bubble's
 * surface. A picture that fails to load is dropped, never drawn as an empty box.
 */
export function WebPageCard(props: { page: WebPagePreview; class?: string; children?: JSX.Element }): JSX.Element {
  const parts = createMemo(() => ({
    host: hostOf(props.page.url) ?? props.page.site ?? "",
    title: limitSymbols(props.page.title, TITLE_LENGTH, TITLE_LIMIT),
    description: limitSymbols(props.page.description, DESCRIPTION_LENGTH, DESCRIPTION_LIMIT),
  }))
  const [failed, setFailed] = createSignal<string | null>(null)
  const media = () => {
    const m = ownMedia(props.page)
    return m && m.src !== failed() ? m : undefined
  }
  const color = () => cardColor(props.page)

  const onLoad = (event: Event) => {
    if (hasCardColor(props.page)) return
    rememberCardColor(props.page, colorOfImage(event.currentTarget as HTMLImageElement))
  }

  return (
    <Show when={hasWebPageContent(props.page)}>
      <a
        class={cn(
          "chat-webpage relative mt-1 block max-w-full overflow-hidden rounded-[18px] no-underline",
          color() ? "text-white" : "bg-message-assistant text-message-assistant-text",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          props.class,
        )}
        style={{ width: `${CARD_WIDTH}px`, "background-color": color() }}
        data-component="chat-webpage"
        data-colored={color() ? "" : undefined}
        href={props.page.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Show when={media()}>
          {(image) => (
            <img
              class="block w-full bg-black/10 object-cover"
              style={{ "aspect-ratio": `${CARD_IMAGE_ASPECT}` }}
              data-slot="chat-webpage-preview"
              src={image().src}
              alt=""
              decoding="async"
              onLoad={onLoad}
              onError={() => setFailed(image().src)}
            />
          )}
        </Show>
        <span class="block px-3 pt-2 pb-2.5 text-[14px] leading-[19px]">
          <Show when={parts().host}>
            <span class={cn("chat-webpage__name block truncate text-[13px] leading-[18px]", color() ? "text-white/70" : "text-weak")}>
              {parts().host}
            </span>
          </Show>
          <Show when={parts().title}>
            <span class="chat-webpage__title mt-0.5 line-clamp-2 text-[15px] leading-[20px] font-semibold wrap-anywhere">
              {parts().title}
            </span>
          </Show>
          <Show when={parts().description}>
            <span class={cn("chat-webpage__text mt-0.5 line-clamp-2 wrap-anywhere", color() ? "text-white/70" : "text-weak")}>
              {parts().description}
            </span>
          </Show>
        </span>
        {props.children}
      </a>
    </Show>
  )
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return undefined
  }
}
