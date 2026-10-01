import { Show, type JSX } from "solid-js"
import { useI18n } from "@kiko/ui/context/i18n"
import { Icon } from "@kiko/ui/icon"
import { Icon as IconV2 } from "@kiko/ui/v2/icon"
import { IconButtonV2 } from "@kiko/ui/v2/icon-button-v2"
import { cn } from "../lib/cn"
import type { WebPagePreview } from "../lib/types"

/**
 * What the composer knows about the link in the draft: the URL it resolved, and
 * the metadata the page actually returned.
 *
 * `preview` is `null` for every answer that is not real metadata — nothing
 * found, a throw, a non-2xx, a non-HTML body — because there is no honest way to
 * tell those apart from outside, and tweb does not try: the preview is an
 * all-or-nothing message-level entity that exists only when the server attached
 * one (`bubbles.ts:9338-9350` breaks out and creates no element at all).
 */
export interface ComposerLinkPreviewProps {
  /** The link the draft carries, already normalized by `draftLinkUrl`. */
  url: string
  /** The page's own metadata, or `null` when there is none. */
  preview: WebPagePreview | null
  /** Stop showing the preview for this URL. The text is the caller's. */
  onDismiss: () => void
  class?: string
}

/**
 * Whether a page described enough to be printed.
 *
 * The site name and the description are the two lines this row draws, so a page
 * with neither has described nothing a row could honestly hold. tweb gates the
 * same way at the field level — `bubbles.ts:9551/9582/9587` set each line only
 * when its field is non-empty — and drops a site name that merely repeats the
 * short title (`appWebPagesManager.ts:128-132`) so a card never prints one
 * string twice. A page with a title and nothing else is a page with nothing to
 * show HERE, and the URL in the input already carries it.
 */
function describedPage(preview: WebPagePreview | null): WebPagePreview | null {
  if (preview === null) return null
  if (preview.site && preview.title && preview.site === preview.title) {
    return { ...preview, site: undefined }
  }
  return preview.site || preview.description ? preview : null
}

/**
 * The composer's link preview: a link glyph, a quote slab carrying the page's
 * name and description, and a dismiss on the right.
 *
 * It is the same entity the transcript's `WebPageCard` draws, at the same rule
 * — the same `chat-webpage__name` treatment for the site name, the same
 * `text-weak` for the description, and the same 3px accent rule down the leading
 * edge, painted as a pseudo-element because a border would spend width the
 * composer does not have. The name is lowercased for the same reason it is there
 * in the card: it is chrome, not the page's words. The description is clamped to
 * two lines rather than the card's three, because the composer has an input
 * under it and a third line is a third line of composer.
 *
 * NOTHING IS DRAWN WITHOUT REAL METADATA. Not a frame, not a URL line, not a
 * grey bar standing in for a title, not a spinner. tweb's renderer breaks before
 * it creates an element (`bubbles.ts:9338-9350`) and the user's rule is the
 * same sentence: a preview that is not really available is not shown. A draft
 * that merely contains a URL therefore shows nothing at all, because the URL is
 * already in the input the reader is typing into — it is the message body, not a
 * preview, and echoing it back one line above would be a decoration pretending
 * to be data.
 *
 * So there is no pending state here to render. A resolve in flight and a resolve
 * that came back with nothing look identical from in here, and identically
 * correct: no row. The caller owns the debounce and the request token; this
 * component reads no composer state, opens no overlay and writes nothing to the
 * draft, so dismissing it is the caller's one signal and cannot lose the text.
 */
export function ComposerLinkPreview(props: ComposerLinkPreviewProps): JSX.Element {
  const i18n = useI18n()
  const page = () => describedPage(props.preview)

  return (
    <Show when={page()}>
      {(shown) => (
        <div
          class={cn("composer-link-preview mb-1.5 flex w-full items-start gap-2", props.class)}
          data-component="composer-link-preview"
        >
          <span class="mt-0.5 shrink-0 text-weak">
            <Icon name="link" size="small" />
          </span>

          <a
            class={cn(
              "chat-webpage__preview relative flex min-w-0 flex-1 flex-col items-start gap-0.5 overflow-hidden",
              "rounded-[8px] bg-tint p-1.5 no-underline text-inherit",
              "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]",
              // The 3px rule down the leading edge, painted rather than
              // bordered — the card's own idiom, at the card's own weight.
              "[&::before]:absolute [&::before]:inset-y-0 [&::before]:start-0 [&::before]:w-[3px]",
              "[&::before]:bg-accent [&::before]:content-['']",
            )}
            data-component="chat-webpage"
            href={props.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Show when={shown().site}>
              {(site) => (
                <span class="chat-webpage__name block max-w-full truncate text-sm font-[var(--font-weight-bold)] text-accent lowercase">
                  {site()}
                </span>
              )}
            </Show>
            <Show when={shown().description}>
              {(description) => (
                <span class="chat-webpage__text line-clamp-2 text-sm text-weak wrap-anywhere">
                  {description()}
                </span>
              )}
            </Show>
          </a>

          <IconButtonV2
            class="-me-1 shrink-0"
            variant="ghost"
            size="small"
            type="button"
            aria-label={i18n.t("ui.common.dismiss")}
            icon={<IconV2 name="xmark-small" class="size-3.5" />}
            onClick={() => props.onDismiss()}
          />
        </div>
      )}
    </Show>
  )
}
