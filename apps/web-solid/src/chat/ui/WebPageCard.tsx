import { Show, createMemo, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { MAX_PREVIEW_HEIGHT, MAX_PREVIEW_WIDTH, hasWebPageContent, ownFavicon, ownMedia } from "../lib/linkPreview"
import type { WebPagePreview } from "../../lib/types"

const TITLE_LENGTH = 80
const TITLE_LIMIT = 100
const DESCRIPTION_LENGTH = 150
const DESCRIPTION_LIMIT = 180

function limitSymbols(value: string | undefined, length: number, limitFrom: number): string {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > limitFrom ? `${trimmed.slice(0, length)}...` : trimmed
}

export function WebPageCard(props: { page: WebPagePreview; class?: string }): JSX.Element {
  const parts = createMemo(() => ({
    site: limitSymbols(props.page.site, TITLE_LENGTH, TITLE_LIMIT),
    title: limitSymbols(props.page.title, TITLE_LENGTH, TITLE_LIMIT),
    description: limitSymbols(props.page.description, DESCRIPTION_LENGTH, DESCRIPTION_LIMIT),
  }))
  const media = () => ownMedia(props.page)
  const large = () => props.page.mediaSize !== "small"

  return (
    <Show when={hasWebPageContent(props.page)}>
      <a
        class={cn(
          "chat-webpage relative mt-1 block w-fit max-w-full overflow-hidden rounded-[6px] py-1.5 pe-2 ps-[11px]",
          "bg-[oklch(from_currentColor_l_c_h/9%)] text-[14px] leading-[18px] text-inherit no-underline",
          "before:absolute before:inset-y-0 before:start-0 before:w-[3px] before:bg-current/70 before:content-['']",
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-current",
          props.class,
        )}
        data-component="chat-webpage"
        href={props.page.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Show when={!large() ? media() : undefined}>
          {(thumb) => (
            <img
              class="float-end ms-2.5 size-12 rounded-[4px] object-cover"
              data-slot="chat-webpage-preview"
              src={thumb().src}
              alt=""
              loading="lazy"
              decoding="async"
            />
          )}
        </Show>
        <Show when={parts().site}>
          <span class="chat-webpage__name flex items-center gap-1.5 font-semibold">
            <Show when={ownFavicon(props.page)}>
              {(icon) => <img class="size-4 shrink-0 rounded-[2px]" src={icon()} alt="" width={16} height={16} />}
            </Show>
            <span class="truncate">{parts().site}</span>
          </span>
        </Show>
        <Show when={parts().title}>
          <span class="chat-webpage__title line-clamp-2 block font-semibold wrap-anywhere">
            {parts().title}
          </span>
        </Show>
        <Show when={parts().description}>
          <span class="chat-webpage__text line-clamp-3 block opacity-90 wrap-anywhere">
            {parts().description}
          </span>
        </Show>
        <Show when={large() ? media() : undefined}>
          {(image) => (
            <span
              class="chat-webpage__preview-resizer mt-1.5 block w-full overflow-hidden rounded-[4px]"
              style={{
                "max-height": `${MAX_PREVIEW_HEIGHT}px`,
                "aspect-ratio": `${image().width} / ${image().height}`,
              }}
            >
              <img
                class="block size-full object-cover"
                data-slot="chat-webpage-preview"
                src={image().src}
                alt=""
                width={image().width}
                height={image().height}
                loading="lazy"
                decoding="async"
              />
            </span>
          )}
        </Show>
      </a>
    </Show>
  )
}
