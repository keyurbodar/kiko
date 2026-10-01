import { Show, createMemo, type JSX } from "solid-js"
import { cn } from "../../lib/cn"
import { MAX_PREVIEW_HEIGHT, hasWebPageContent } from "../lib/linkPreview"
import type { WebPagePreview } from "../../lib/types"

function limitSymbols(str: string, length: number, limitFrom = length + 10): string {
  const trimmed = str.trim()
  return trimmed.length > limitFrom ? `${trimmed.slice(0, length)}...` : trimmed
}

const TITLE_LENGTH = 80
const TITLE_LIMIT = 100
const DESCRIPTION_LENGTH = 150
const DESCRIPTION_LIMIT = 180

const CARD_WIDTH = 520

function accentOf(page: WebPagePreview): string | undefined {
  return "accent" in page && typeof page.accent === "string" ? page.accent : undefined
}

const LIGHT_SURFACE_L = 0.62;

function inkFor(accent: string | undefined): string {
  if (accent === undefined) return "var(--bg)"
  const match = /^oklch\(([\d.]+)/.exec(accent.trim())
  if (match === null) return "var(--bg)"
  return Number(match[1]) >= LIGHT_SURFACE_L ? "var(--bg)" : "var(--text)"
}

function WebPageName(props: { site: string }) {
  return (
    <span class="chat-webpage__name block max-w-full truncate text-xs text-[var(--webpage-ink-weak)] lowercase">
      {props.site}
    </span>
  )
}

function WebPageTitle(props: { title: string }) {
  return (
    <span class="chat-webpage__title line-clamp-3 text-base font-[var(--font-weight-bold)] text-[var(--webpage-ink)]">
      {props.title}
    </span>
  )
}

function WebPageText(props: { description: string }) {
  return (
    <span class="chat-webpage__text line-clamp-3 text-sm wrap-anywhere text-[var(--webpage-ink-weak)]">
      {props.description}
    </span>
  )
}

function WebPageMedia(props: { media: NonNullable<WebPagePreview["media"]> }) {
  const aspect = () =>
    props.media.width > 0 && props.media.height > 0
      ? props.media.width / props.media.height
      : 1.5
  return (
    <span
      class="chat-webpage__preview-resizer block w-full overflow-hidden bg-[var(--input-bg)]"
      style={{
        "max-height": `${MAX_PREVIEW_HEIGHT}px`,
        "aspect-ratio": String(aspect()),
      }}
    >
      <img
        class="block size-full object-cover"
        data-slot="chat-webpage-preview"
        src={props.media.src}
        alt=""
        width={props.media.width}
        height={props.media.height}
        loading="lazy"
        decoding="async"
      />
    </span>
  )
}

export function WebPageCard(props: { page: WebPagePreview; class?: string }): JSX.Element {
  const line = (value: string | undefined, length: number, limitFrom: number) =>
    value ? limitSymbols(value, length, limitFrom) : ""

  const parts = createMemo(() => ({
    site: line(props.page.site, TITLE_LENGTH, TITLE_LIMIT),
    title: line(props.page.title, TITLE_LENGTH, TITLE_LIMIT),
    description: line(props.page.description, DESCRIPTION_LENGTH, DESCRIPTION_LIMIT),
    media: props.page.media,
    mediaPosition: props.page.mediaPosition,
  }))

  return (
    <Show when={hasWebPageContent(props.page)}>
      <a
        class={cn(
          "chat-webpage relative -mx-3 block overflow-hidden no-underline rounded-bubble",
          "bg-[var(--webpage-accent,var(--text))]",
          "[--webpage-ink-weak:color-mix(in_oklch,var(--webpage-ink)_58%,var(--webpage-accent,var(--text)))]",
          "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]",
          props.class,
        )}
        style={{
          width: `${CARD_WIDTH}px`,
          "--webpage-accent": accentOf(props.page),
          "--webpage-ink": inkFor(accentOf(props.page)),
        }}
        data-component="chat-webpage"
        href={props.page.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        <Show when={parts().mediaPosition === "top" ? parts().media : undefined}>
          {(media) => <WebPageMedia media={media()} />}
        </Show>
        <Show when={parts().site || parts().title || parts().description}>
          <span class="chat-webpage__content flex w-full min-w-0 flex-col items-start gap-1 p-3 ps-[15px]">
            <Show when={parts().site}>{(site) => <WebPageName site={site()} />}</Show>
            <Show when={parts().title}>{(title) => <WebPageTitle title={title()} />}</Show>
            <Show when={parts().description}>
              {(description) => <WebPageText description={description()} />}
            </Show>
          </span>
        </Show>
        <Show when={parts().mediaPosition === "top" ? undefined : parts().media}>
          {(media) => <WebPageMedia media={media()} />}
        </Show>
      </a>
    </Show>
  )
}
