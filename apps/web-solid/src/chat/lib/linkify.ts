import { tokenize } from "linkifyjs";

/**
 * One run of message text. `href` is null for every run that is not a URL, so
 * the renderer needs exactly one branch: an anchor when there is an href, and
 * the raw text when there is not.
 */
export type Segment = {
  text: string;
  href: string | null;
};

/**
 * Split a message body into the runs the renderer walks. Prose keeps its own
 * runs so the text between two links survives, and only a `url` token carries
 * an href: `email`, `mention` and `hashtag` stay plain text, because a mailto
 * link on a chat bubble reads as a misparse and a mention or hashtag is prose
 * the sender typed, not somewhere to navigate.
 *
 * linkifyjs owns the matching, which is what keeps sentence furniture out of
 * the href: it reads a trailing full stop, comma or closing bracket as
 * punctuation and ends the URL before them. A bare `http://` is not a URL to
 * linkifyjs, so it degrades to a text run instead of throwing.
 *
 * `toHref("https")` rather than the library default of `http`, so a
 * scheme-less `www.` run becomes an https link.
 */
export function linkifySegments(text: string): Segment[] {
  return tokenize(text).map((token) => ({
    text: token.toString(),
    href: token.t === "url" ? token.toHref("https") : null,
  }));
}

/**
 * The host to label a preview card with, without a `www.` prefix. A host the
 * URL parser rejects comes back unchanged: a card is chrome, and losing its
 * label to an exception would take the whole message render down with it.
 */
export function previewHostOf(href: string): string {
  try {
    return new URL(href).host.replace(/^www\./, "");
  } catch {
    return href;
  }
}
