import type { TimelineItem } from "./grouping";
import { graphemes, jumboEmojiClass } from "./reply";

/**
 * The one height table. Every number below is read off the rendered metrics in
 * kat's chat CSS; nothing here may be re-derived at a call site.
 */

/** `--font-base`. */
const FONT_BASE = 14;
/** `--line-height`; one bubble text line is 14 * 1.45 = 20.3px. */
const LINE_BOX = FONT_BASE * 1.45;
/** `--font-xs`, used by the date chip, unread rule and row time. */
const LINE_BOX_CHROME = 11 * 1.45;

/** `.bubble { padding: 7px 12px }` — 7px top plus 7px bottom. */
const BUBBLE_PAD_Y = 14;
/** `.message-row { padding: 1px 16px }` — 1px top plus 1px bottom. */
const ROW_PAD_Y = 2;
/**
 * `.message-row.group-gap { padding-top: 8px }`. It REPLACES the row's 1px top
 * padding rather than adding to it, so a run break reads 7px taller than a run
 * continuation. Model both halves so the estimate matches the DOM either way.
 */
const RUN_GAP_PX = 8;

/** `.time-separator { padding: 14px 16px 10px }`. */
const DAY_DIVIDER_PAD_Y = 24;
/** `.unread-rule { padding: 12px 16px 8px }`. */
const UNREAD_RULE_PAD_Y = 20;

/**
 * Characters per rendered bubble line, measured rather than assumed.
 *
 * The bubble is `max-width: 80%` of a `--content-max-w` (768px) column that has
 * already lost 16px of row padding per side, then loses 12px of its own padding
 * per side, which leaves 0.80 * (768 - 32) - 24 = 564.8px of text column. At
 * `--font-base` 14px in Inter Variable, mixed-case English prose averages about
 * 0.46em (6.44px) of advance, putting a line at 564.8 / 6.44 = 87.7, so 87.
 * The 94 and 96 that used to live in the old tables assumed a bubble wide
 * enough for 11px prose and are wrong for this one.
 */
const CHARS_PER_LINE = 87;

/** `.reply-quote { font-size: var(--font-sm); line-height: 1.35 }`. */
const QUOTE_LINE = 12 * 1.35;
/** One clamped label line plus two clamped text lines (`-webkit-line-clamp: 2`). */
const QUOTE_LINES = 3;
/** `.reply-quote { padding: 5px 8px 5px 11px; margin-bottom: 4px }`. */
const QUOTE_CHROME_Y = 5 + 5 + 4;
/** `.jumbo-emoji-* { line-height: 1.25 }`. */
const JUMBO_SINGLE_PX = FONT_BASE * 3.5 * 1.25 + BUBBLE_PAD_Y;
const JUMBO_GROUP_PX = FONT_BASE * 2.5 * 1.25 + BUBBLE_PAD_Y;

function bubbleTextLines(body: string): number {
  return Math.max(1, Math.ceil(graphemes(body.trim()).length / CHARS_PER_LINE));
}

/**
 * Predicted row height in CSS pixels for any timeline row, dividers included.
 *
 * A virtualizer only needs this to be close and stable: it measures the real
 * rows afterwards and corrects. Rounding up keeps a wrapped bubble from being
 * clipped on the first paint.
 */
export function estimateRowHeight(item: TimelineItem): number {
  if (item.kind === "day-divider") return Math.ceil(DAY_DIVIDER_PAD_Y + LINE_BOX_CHROME);
  if (item.kind === "unread-divider") return Math.ceil(UNREAD_RULE_PAD_Y + LINE_BOX_CHROME);

  const { message } = item;
  const jumbo = jumboEmojiClass(message.body);
  const bubble =
    jumbo === "jumbo-single"
      ? JUMBO_SINGLE_PX
      : jumbo === "jumbo-group"
        ? JUMBO_GROUP_PX
        : BUBBLE_PAD_Y + LINE_BOX * bubbleTextLines(message.body);
  // The quote is the bubble's first child, so its height lands inside the
  // bubble, above the body line.
  const quote = message.replyToId === undefined ? 0 : QUOTE_LINE * QUOTE_LINES + QUOTE_CHROME_Y;

  const rowPadTop = item.hasRunGapBefore ? RUN_GAP_PX : 1;
  return Math.ceil(bubble + quote + rowPadTop + 1);
}