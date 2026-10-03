import type { ChatMessage, WebPagePreview } from "../../lib/types";
import { albumLayout, singleMediaBox } from "./album";
import type { TimelineItem } from "./grouping";
import { graphemes, jumboEmojiClass } from "./reply";
import { CARD_IMAGE_ASPECT, CARD_WIDTH, hasWebPageContent } from "./linkPreview";

const FONT_BASE = 14;
const LINE_BOX = FONT_BASE * 1.45;
const LINE_BOX_CHROME = 11 * 1.45;

const BUBBLE_PAD_TOP = 7;
const BUBBLE_PAD_Y = BUBBLE_PAD_TOP * 2;
const ROW_PAD_Y = 2;
const RUN_GAP_PX = 8;

const DAY_DIVIDER_PAD_Y = 24;
const UNREAD_RULE_PAD_Y = 20;

const CHARS_PER_LINE = 87;

const QUOTE_LINE = 12 * 1.35;
const QUOTE_LINES = 3;
const QUOTE_CHROME_Y = 5 + 5 + 4;

const JUMBO_SINGLE_PX = 42 * 1.25;
const JUMBO_GROUP_PX = 31 * 1.25;

const CAPTION_PAD_Y = 5 + 7;

const DOCUMENT_ICON_PX = 48;
const DOCUMENT_ROW_PAD_Y = 8;
const DOCUMENT_ROW_PX = DOCUMENT_ICON_PX + DOCUMENT_ROW_PAD_Y * 2;

// The link card under the bubble: a 4px gap, 10 + 12 px padding, then 18px site, 20px title, and 19px text lines.
const CARD_CHROME_Y = 4 + 10 + 12;
const CARD_SITE_LINE = 18;
const CARD_TITLE_LINE = 20;
const CARD_TEXT_LINE = 19;
const CARD_MAX_LINES = 2;
const CARD_CHARS_PER_LINE = 40;

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

function clampedLines(text: string | undefined): number {
  const length = text?.trim().length ?? 0;
  if (length === 0) return 0;
  return Math.min(CARD_MAX_LINES, Math.ceil(length / CARD_CHARS_PER_LINE));
}

function cardHeight(page: WebPagePreview | undefined): number {
  if (page === undefined || !hasWebPageContent(page)) return 0;
  const image = page.media !== undefined && page.mediaSize !== "small" ? CARD_WIDTH / CARD_IMAGE_ASPECT : 0;
  return (
    CARD_CHROME_Y +
    image +
    CARD_SITE_LINE +
    clampedLines(page.title) * CARD_TITLE_LINE +
    clampedLines(page.description) * CARD_TEXT_LINE
  );
}

function bubbleTextLines(body: string): number {
  return Math.max(1, Math.ceil(graphemes(body.trim()).length / CHARS_PER_LINE));
}

export function estimateRowHeight(item: TimelineItem): number {
  if (item.kind === "day-divider") return Math.ceil(DAY_DIVIDER_PAD_Y + LINE_BOX_CHROME);
  if (item.kind === "unread-divider") return Math.ceil(UNREAD_RULE_PAD_Y + LINE_BOX_CHROME);
  // A notice is one `py-1` line of 12px text; a thread line is a 28px pill with the run gap above.
  if (item.kind === "notice") return Math.ceil(8 + LINE_BOX_CHROME);
  if (item.kind === "thread") return RUN_GAP_PX + 28 + 2;

  const { message } = item;
  const attachments =
    mediaBlockHeight(message) + (message.documents?.length ?? 0) * DOCUMENT_ROW_PX;
  const caption = message.body.trim().length > 0;
  const captionBlock = message.body.length > 0 || hasWebPageContent(message.webPage);
  const jumbo = attachments > 0 ? undefined : jumboEmojiClass(message.body);
  const text = bubbleTextLines(message.body);
  const bubble =
    attachments > 0
      ? attachments + (captionBlock ? CAPTION_PAD_Y + (caption ? LINE_BOX * text : 0) : 0)
      : jumbo === "jumbo-single"
        ? JUMBO_SINGLE_PX
        : jumbo === "jumbo-group"
          ? JUMBO_GROUP_PX
          : BUBBLE_PAD_Y + LINE_BOX * text;
  const card = cardHeight(message.webPage);
  const quote = message.replyToId === undefined ? 0 : QUOTE_LINE * QUOTE_LINES + QUOTE_CHROME_Y;

  const rowPadTop = item.hasRunGapBefore ? RUN_GAP_PX : 1;
  return Math.ceil(bubble + card + quote + rowPadTop + 1);
}
