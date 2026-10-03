import { Show, createMemo, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { CARD_IMAGE_ASPECT, CARD_WIDTH, hasWebPageContent, ownFavicon, ownMedia } from "../lib/linkPreview"
import type { WebPagePreview } from "../../lib/types"

const TITLE_LENGTH = 80
const TITLE_LIMIT = 100
const DESCRIPTION_LENGTH = 150
const DESCRIPTION_LIMIT = 180

function limitSymbols(value: string | undefined, length: number, limitFrom: number): string {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > limitFrom ? `${trimmed.slice(0, length)}...` : trimmed
}

/** The kat link card: its own block under the bubble, the picture on top, then site, title, and two lines of text. */
export function WebPageCard(props: { page: WebPagePreview; class?: string }): JSX.Element {
  const parts = createMemo(() => ({
    site: limitSymbols(props.page.site ?? hostOf(props.page.url), TITLE_LENGTH, TITLE_LIMIT),
    title: limitSymbols(props.page.title, TITLE_LENGTH, TITLE_LIMIT),
    description: limitSymbols(props.page.description, DESCRIPTION_LENGTH, DESCRIPTION_LIMIT),
  }))
  const media = () => ownMedia(props.page)
  const large = () => props.page.mediaSize !== "small"

  return (
    <Show when={hasWebPageContent(props.page)}>
      <a
        class={cn(
          "chat-webpage mt-1 block max-w-full overflow-hidden rounded-[18px] bg-[#efefef] text-[#111] no-underline",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          props.class,
        )}
        style={{ width: `${CARD_WIDTH}px` }}
        data-component="chat-webpage"
        href={props.page.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Show when={large() ? media() : undefined}>
          {(image) => (
            <img
              class="block w-full object-cover"
              style={{ "aspect-ratio": `${CARD_IMAGE_ASPECT}` }}
              data-slot="chat-webpage-preview"
              src={image().src}
              alt=""
              loading="lazy"
              decoding="async"
            />
          )}
        </Show>
        <span class="block px-3 pt-2.5 pb-3 text-[14px] leading-[19px]">
          <Show when={!large() ? media() : undefined}>
            {(thumb) => (
              <img
                class="float-end ms-2.5 size-12 rounded-[6px] object-cover"
                data-slot="chat-webpage-preview"
                src={thumb().src}
                alt=""
                loading="lazy"
                decoding="async"
              />
            )}
          </Show>
          <Show when={parts().site}>
            <span class="chat-webpage__name flex items-center gap-1.5 text-[13px] leading-[18px] text-[#555]">
              <Show when={ownFavicon(props.page)}>
                {(icon) => <img class="size-3.5 shrink-0 rounded-[2px]" src={icon()} alt="" width={14} height={14} />}
              </Show>
              <span class="truncate">{parts().site}</span>
            </span>
          </Show>
          <Show when={parts().title}>
            <span class="chat-webpage__title mt-0.5 line-clamp-2 text-[15px] leading-[20px] font-semibold wrap-anywhere">
              {parts().title}
            </span>
          </Show>
          <Show when={parts().description}>
            <span class="chat-webpage__text mt-0.5 line-clamp-2 text-[#444] wrap-anywhere">{parts().description}</span>
          </Show>
        </span>
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
