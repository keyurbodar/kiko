import { Show, type JSX } from "solid-js"
import { ArrowUpRight } from "lucide-solid"
import { cn } from "../../lib/cn"
import type { WebPagePreview } from "../../lib/types"

/**
 * Trim a string to `length`, but only once it has outgrown `limitFrom`.
 *
 * The two thresholds are the point: a title of 84 characters is not shortened
 * to 80 and given an ellipsis for four characters' sake, it is left whole and
 * wraps. Only a string that would run past the card's own height is cut, and
 * then the cut is announced. Leading whitespace goes first, because a leading
 * space survives `slice` and would push the ellipsis one column in.
 */
function limitSymbols(str: string, length: number, limitFrom = length + 10): string {
  const trimmed = str.trim()
  return trimmed.length > limitFrom ? `${trimmed.slice(0, length)}...` : trimmed
}

/** tweb's 80/100 and 150/180 pairs, kept as named constants so the two cut
 *  points are read as the page's own limits rather than as magic numbers. */
const TITLE_LENGTH = 80
const TITLE_LIMIT = 100
const DESCRIPTION_LENGTH = 150
const DESCRIPTION_LIMIT = 180

/**
 * The card's last line: the page's own label for the action, plus the arrow
 * that says it leaves the app. tweb draws a hairline above this row; there is
 * no hairline here, so the row is separated by its own space and the weaker
 * text colour instead.
 */
function WebPageFooter(props: { label: string }) {
  return (
    <span class="chat-webpage__footer mt-1.5 flex items-center gap-1 text-sm lowercase text-weak">
      <span class="truncate">{props.label}</span>
      <ArrowUpRight class="size-3.5 shrink-0" aria-hidden="true" />
    </span>
  )
}

/**
 * The site name — the card's first line and the only one tweb prints in the
 * page's accent colour. It is chrome, so it is lowercased; the title and the
 * description below it are the page's own text and are left exactly as sent.
 */
function WebPageName(props: { site: string }) {
  return (
    <span class="chat-webpage__name block max-w-full truncate text-sm font-[var(--font-weight-bold)] text-accent lowercase">
      {props.site}
    </span>
  )
}

/** The page's title. Bold, and clamped to the two lines a card can spend. */
function WebPageTitle(props: { title: string }) {
  return (
    <span class="chat-webpage__title line-clamp-2 text-sm font-[var(--font-weight-bold)]">
      {props.title}
    </span>
  )
}

/** The page's description, in the transcript's weaker text colour. */
function WebPageText(props: { description: string }) {
  return <span class="chat-webpage__text line-clamp-3 text-sm text-weak wrap-anywhere">{props.description}</span>
}

/**
 * The preview picture, in a box taken from the image's own intrinsic size.
 *
 * tweb mounts the picture before its bytes arrive and resizes the box once they
 * land; here the intrinsic size is already on the message, so the box is the
 * ratio and the cap is fixed. `object-cover` then crops rather than squashes
 * when the two disagree, and the width/height attributes give the browser the
 * same ratio before load so the card does not jump.
 */
function WebPageMedia(props: { media: NonNullable<WebPagePreview["media"]> }) {
  const aspect = () =>
    props.media.width > 0 && props.media.height > 0 ? props.media.width / props.media.height : 1.5
  return (
    <span
      class="chat-webpage__preview-resizer mb-1.5 block w-full overflow-hidden rounded-[8px] bg-[var(--input-bg)]"
      style={{ width: "min(420px, 100%)", "aspect-ratio": String(aspect()) }}
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

/**
 * The link preview a message carries: the page's name, title, description and
 * picture, composed exactly the way tweb composes them.
 *
 * The nesting is tweb's — an outer anchor, then a quote slab, then the content
 * column that holds the media, the three text lines and the footer. The media
 * is a sibling of the text, not a child of it, so `mediaPosition` decides
 * whether it sits above the name or between the description and the footer,
 * and the column needs no reordering to say so.
 *
 * tweb's `quote-like-border` is a 3px rule down the leading edge. A border
 * would add width the card does not have inside a bubble, so the rule is a
 * painted bar instead: an absolutely positioned pseudo-element, the same idiom
 * the reply quote uses. The slab is a tint of the token layer rather than a
 * raised panel, because the card is already inside a bubble and a raised
 * surface on top of one reads as a second window.
 *
 * Every part renders only when it has content, the way tweb's
 * `props?.content && (...)` guards do: a page with nothing but a title is one
 * line, not four lines with three of them blank. Nothing here transitions or
 * animates — the reader is not waiting on the card, they are reading it.
 */
export function WebPageCard(props: { page: WebPagePreview; class?: string }): JSX.Element {
  // Cut before the guard, not after: a field that is absent, blank, or nothing
  // but whitespace has to collapse its line, and `limitSymbols` is what turns
  // the last two cases into the first.
  const line = (value: string | undefined, length: number, limitFrom: number) =>
    value ? limitSymbols(value, length, limitFrom) : ""

  return (
    <a
      class={cn(
        "chat-webpage block w-80 max-w-full no-underline text-inherit",
        "relative overflow-hidden rounded-[calc(var(--radius-bubble)-7px)] bg-tint p-2",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]",
        // The 3px rule down the leading edge, painted rather than bordered.
        "[&::before]:absolute [&::before]:inset-y-0 [&::before]:start-0 [&::before]:w-[3px]",
        "[&::before]:bg-accent [&::before]:content-['']",
        props.class,
      )}
      data-component="chat-webpage"
      href={props.page.url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span class="chat-webpage__quote flex w-full overflow-hidden">
        <span class="chat-webpage__content flex min-w-0 flex-1 flex-col items-start gap-0.5 overflow-hidden">
          {/* The media is a sibling of the text, not a child of it, so its
              *position* is decided here rather than by reordering the column. */}
          <Show when={props.page.mediaPosition === "top" ? props.page.media : undefined}>
            {(media) => <WebPageMedia media={media()} />}
          </Show>
          <Show when={line(props.page.site, TITLE_LENGTH, TITLE_LIMIT)}>
            {(site) => <WebPageName site={site()} />}
          </Show>
          <Show when={line(props.page.title, TITLE_LENGTH, TITLE_LIMIT)}>
            {(title) => <WebPageTitle title={title()} />}
          </Show>
          <Show when={line(props.page.description, DESCRIPTION_LENGTH, DESCRIPTION_LIMIT)}>
            {(description) => <WebPageText description={description()} />}
          </Show>
          <Show when={props.page.mediaPosition === "top" ? undefined : props.page.media}>
            {(media) => <WebPageMedia media={media()} />}
          </Show>
          <Show when={line(props.page.footer, TITLE_LENGTH, TITLE_LIMIT)}>
            {(footer) => <WebPageFooter label={footer()} />}
          </Show>
        </span>
      </span>
    </a>
  )
}
