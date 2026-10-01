// Which link a half-written composer draft is about.
//
// The matcher is `richTextSegments`, not a second regex: kiko already decides
// what is a url, an address, a mention and a hashtag, gates a scheme-less run on
// a real TLD, trims prose punctuation off the end of a path, and refuses to
// hand back an href whose visible host and real host disagree. A composer-side
// url regex would have to re-derive all of that and would drift from the
// transcript the moment any of it changed — the two surfaces would then
// disagree about whether the same text is a link, which is the one thing a
// reader notices immediately.

import { richTextSegments } from "../chat/lib/richtext/segments"

/**
 * The URL a draft is about, or `null` when it does not carry one.
 *
 * The FIRST url, not the last and not the one nearest the caret. That is the
 * order tweb and Telegram send the text in, and it is the only order that
 * survives the text being edited: an author who revises the sentence after the
 * link expects the preview to stay on the link they wrote first, and a
 * caret-relative rule would swap the preview out from under them mid-sentence.
 *
 * A suspicious run is skipped rather than previewed. Its visible host and its
 * real host disagree, so the metadata fetched for it belongs to a site the
 * visible text does not name — the one case where printing a page's own title
 * next to the URL is a lie rather than a convenience. `null` is the honest
 * answer there, and it is the same answer the transcript gives by dropping the
 * href.
 *
 * While a URL is still being typed this returns whatever prefix already parses,
 * which is why the caller debounces and re-reads rather than treating the first
 * result as final.
 */
export function draftLinkUrl(text: string): string | null {
  for (const segment of richTextSegments(text)) {
    if (segment.kind !== "url" || segment.suspicious || !segment.href) continue
    return segment.href
  }

  return null
}
