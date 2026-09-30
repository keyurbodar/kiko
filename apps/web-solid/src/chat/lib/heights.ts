import type { ChatMessage } from "../../lib/types";
import { albumLayout, singleMediaBox } from "./album";
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
const BUBBLE_PAD_TOP = 7;
const BUBBLE_PAD_Y = BUBBLE_PAD_TOP * 2;
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
/**
 * `.jumbo-emoji-* { line-height: 1.25 }`. An emoji-only bubble is BARE — no fill
 * and no padding — so unlike an ordinary bubble the padding is not part of the
 * height and only the line box counts. These two numbers must move with the
 * `text-[42px]` / `text-[31px]` utilities in `MessageRow`, or the virtualizer
 * reserves room that is not there and the scroll anchor drifts.
 */
const JUMBO_SINGLE_PX = 42 * 1.25;
const JUMBO_GROUP_PX = 31 * 1.25;

/**
 * The caption block's own `py-[7px]` — the bubble's vertical padding, moved
 * onto the caption once the media has taken the bubble's edges. A media-only
 * message has no caption block at all, so it pays nothing here.
 */
const CAPTION_PAD_Y = BUBBLE_PAD_Y;

/**
 * The web page card: its own padding, its 2px top margin, and the four lines
 * its name, title, description and footer can occupy.
 *
 * This is the roughest number in the table, and deliberately so: the card's
 * real height depends on how its title and description wrap, which is not
 * knowable from the message. Under-reserving it would cost the virtualizer
 * more than a close guess does, because a row that is 100px short drags every
 * row below it until the measurement lands.
 */
const CARD_PAD_Y = 22;
const CARD_LINES = 4;

/**
 * The height the media block reserves, which is the whole point of the album
 * geometry being pure: the box a photo or an album will occupy is computed
 * here, before the bytes land, and it is the same computation the renderer
 * uses. A single item draws as one fitted box and two or more draw as a grid,
 * mirroring the renderer's own split.
 *
 * A media item's intrinsic size is required rather than optional for exactly
 * this reason. An item with no known size would reserve nothing, and an album
 * whose cells resize on load moves the scroll anchor of every row beneath it.
 */
function mediaBlockHeight(message: ChatMessage): number {
  const media = message.media;
  if (media === undefined || media.length === 0) return 0;
  const hasText = message.body.trim().length > 0;
  if (media.length === 1) {
    const only = media[0];
    return singleMediaBox(
      { w: only.width, h: only.height },
      { hasText, isVideo: only.kind === "video" },
    ).height;
  }
  return albumLayout(media.map((item) => ({ w: item.width, h: item.height }))).height;
}

function bubbleTextLines(body: string): number {
  return Math.max(1, Math.ceil(graphemes(body.trim()).length / CHARS_PER_LINE));
}

/**
 * Predicted row height in CSS pixels for any timeline row, dividers included.
 *
 * A virtualizer only needs this to be close and stable: it measures the real
 * rows afterwards and corrects. Rounding up keeps a wrapped bubble from being
 * clipped on the first paint.
 *
 * A reaction contributes NOTHING to this. Its badge is absolutely positioned
 * and the row's padding is constant, so reacting never changes a height - the
 * transcript must not move when a chip appears.
 *
 * Media is the one term that cannot be approximated away. A single picture
 * reserves up to 420x400 and an album up to 420x591, against a text bubble's
 * ~34px, so a row estimated without it is short by more than an order of
 * magnitude - and the virtualizer's correction only fires once the row is
 * measured, which is after the transcript has already scrolled wrong. The
 * numbers come from the same pure geometry the renderer uses, so the reserve
 * and the painted box are one computation rather than two that agree.
 */
export function estimateRowHeight(item: TimelineItem): number {
  if (item.kind === "day-divider") return Math.ceil(DAY_DIVIDER_PAD_Y + LINE_BOX_CHROME);
  if (item.kind === "unread-divider") return Math.ceil(UNREAD_RULE_PAD_Y + LINE_BOX_CHROME);

  const { message } = item;
  const media = mediaBlockHeight(message);
  const caption = message.body.trim().length > 0;
  /**
   * The caption block is rendered whenever there is a body OR a card, which is
   * `MessageRow`'s own condition, so a media message whose only text is a card
   * still pays the block's padding. Its line box is only paid when there is
   * actually a body: `bubbleTextLines` floors at one line, and a card-only
   * message would otherwise reserve a blank line above the card.
   */
  const captionBlock = message.body.length > 0 || message.webPage !== undefined;
  // A jumbo bubble is a message whose WHOLE body is emoji, which a message
  // carrying media is not: the emoji is a caption beside a picture, so it takes
  // the caption's line box rather than the 42px one.
  const jumbo = media > 0 ? undefined : jumboEmojiClass(message.body);
  const text = bubbleTextLines(message.body);
  const bubble =
    media > 0
      ? media + (captionBlock ? CAPTION_PAD_Y + (caption ? LINE_BOX * text : 0) : 0)
      : jumbo === "jumbo-single"
        ? JUMBO_SINGLE_PX
        : jumbo === "jumbo-group"
          ? JUMBO_GROUP_PX
          : BUBBLE_PAD_Y + LINE_BOX * text;
  // The card is a child of the caption block, so a message with media pays its
  // padding once, inside that block, and a message without media pays it as
  // part of the bubble's own padding.
  const card = message.webPage === undefined ? 0 : CARD_PAD_Y + LINE_BOX * CARD_LINES;
  // The quote is the bubble's first child, so its height lands inside the
  // bubble, above the body line.
  const quote = message.replyToId === undefined ? 0 : QUOTE_LINE * QUOTE_LINES + QUOTE_CHROME_Y;

  const rowPadTop = item.hasRunGapBefore ? RUN_GAP_PX : 1;
  return Math.ceil(bubble + card + quote + rowPadTop + 1);
}