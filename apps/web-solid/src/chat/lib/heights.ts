import type { ChatMessage, WebPagePreview } from "../../lib/types";
import { albumLayout, singleMediaBox } from "./album";
import type { TimelineItem } from "./grouping";
import { graphemes, jumboEmojiClass } from "./reply";
import { hasWebPageContent, MAX_PREVIEW_HEIGHT, MAX_PREVIEW_WIDTH } from "./linkPreview";

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

const CARD_PAD_Y = 8;
const CARD_TEXT_LINE = 20;
const CARD_TITLE_MAX_LINES = 2;
const CARD_DESCRIPTION_MAX_LINES = 3;
const CARD_CHARS_PER_LINE = 50;
const CARD_FALLBACK_ASPECT = 1.5;

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

function clampedLines(text: string | undefined, maxLines: number): number {
  const length = text?.trim().length ?? 0;
  if (length === 0) return 0;
  return Math.min(maxLines, Math.ceil(length / CARD_CHARS_PER_LINE));
}

function cardHeight(page: WebPagePreview | undefined): number {
  if (page === undefined || !hasWebPageContent(page)) return 0;
  const siteLines = page.site?.trim() ? 1 : 0;
  const textLines =
    siteLines +
    clampedLines(page.title, CARD_TITLE_MAX_LINES) +
    clampedLines(page.description, CARD_DESCRIPTION_MAX_LINES);
  const image =
    page.media !== undefined && page.mediaSize !== "small"
      ? Math.min(
          MAX_PREVIEW_WIDTH *
            (page.media.width > 0 && page.media.height > 0
              ? page.media.height / page.media.width
              : 1 / CARD_FALLBACK_ASPECT),
          MAX_PREVIEW_HEIGHT,
        )
      : 0;
  return CARD_PAD_Y + textLines * CARD_TEXT_LINE + image;
}

function bubbleTextLines(body: string): number {
  return Math.max(1, Math.ceil(graphemes(body.trim()).length / CHARS_PER_LINE));
}

export function estimateRowHeight(item: TimelineItem): number {
  if (item.kind === "day-divider") return Math.ceil(DAY_DIVIDER_PAD_Y + LINE_BOX_CHROME);
  if (item.kind === "unread-divider") return Math.ceil(UNREAD_RULE_PAD_Y + LINE_BOX_CHROME);

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
