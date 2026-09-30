/** Characters of quoted text kept before the ellipsis. */
const REPLY_QUOTE_MAX_CHARS = 140;

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** One emoji presentation, or a regional-indicator flag pair. */
const EMOJI_UNIT = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{1,2})$/u;
const EMOJI_VARIATION = /[\uFE0E\uFE0F]/gu;
const SKIN_TONE = /[\u{1F3FB}-\u{1F3FF}]/gu;
const ZERO_WIDTH_JOINER = /\u200D/u;
const KEYCAP = /\u20E3/u;

/** Split into user-perceived characters; every clamp counts with this. */
export function graphemes(value: string): string[] {
  return Array.from(GRAPHEMES.segment(value), (part) => part.segment);
}

/**
 * One-line preview of a quoted message, sized for a `line-clamp-1` element.
 * Whitespace collapses to single spaces; anything past the budget is cut on a
 * grapheme boundary so an emoji or a combining accent is never halved.
 */
export function replyQuoteText(parent: string | null | undefined): string {
  if (!parent) return "";
  const collapsed = parent.replace(/\s+/g, " ").trim();
  if (collapsed.length <= REPLY_QUOTE_MAX_CHARS) return collapsed;

  let out = "";
  for (const part of graphemes(collapsed)) {
    if (out.length + part.length > REPLY_QUOTE_MAX_CHARS) break;
    out += part;
  }
  return `${out}…`;
}

function isEmoji(grapheme: string): boolean {
  if (KEYCAP.test(grapheme)) return true;
  const base = grapheme.replace(EMOJI_VARIATION, "").replace(SKIN_TONE, "");
  return base.split(ZERO_WIDTH_JOINER).every((unit) => EMOJI_UNIT.test(unit));
}

/**
 * Jumbo sizing for a bubble whose whole body is emoji: one cluster, or two or
 * three. Counted in grapheme clusters so `?` + a variation selector is one
 * emoji and not two, and so a ZWJ family is one and not seven.
 */
export function jumboEmojiClass(body: string): "jumbo-single" | "jumbo-group" | undefined {
  const parts = graphemes(body.trim());
  if (parts.length < 1 || parts.length > 3) return undefined;
  if (!parts.every(isEmoji)) return undefined;
  return parts.length === 1 ? "jumbo-single" : "jumbo-group";
}
