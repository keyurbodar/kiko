import type { ChatMessage } from "../../lib/types";
import { splitFiles } from "../../lib/attachments";
import type { TimelineItem } from "./grouping";
import { graphemes, jumboEmojiClass } from "./reply";
import { currentLimit, FOLD_BUTTON_PX } from "./fold";

const FONT_BASE = 14;
const LINE_BOX = FONT_BASE + 6;

const BUBBLE_PAD_TOP = 8;
const BUBBLE_PAD_Y = BUBBLE_PAD_TOP * 2;
const ROW_GAP_PX = 1;
const RUN_GAP_PX = 11;

const EVENT_ROW_PX = 32;
const RUN_ERROR_ROW_PX = 42;
const CHARS_PER_LINE = 87;

const QUOTE_LINE = 12 * 1.35;
const QUOTE_LINES = 3;
const QUOTE_CHROME_Y = 5 + 5 + 4;

const JUMBO_SINGLE_PX = 42 * 1.25;
const JUMBO_GROUP_PX = 31 * 1.25;

const GRID_WIDTH = 210;
const GRID_GAP = 8;
const FILE_ROW_PX = 28;
const FILE_ROW_GAP = 4;
const ATTACHMENT_GAP = 8;

function attachmentsHeight(message: ChatMessage): number {
  const { images, others } = splitFiles(message.files ?? []);
  const rows = Math.ceil(images.length / 2);
  const tile = images.length === 1 ? GRID_WIDTH : (GRID_WIDTH - GRID_GAP) / 2;
  const grid = rows === 0 ? 0 : (rows * tile * 3) / 4 + (rows - 1) * GRID_GAP;
  const list = others.length === 0 ? 0 : others.length * FILE_ROW_PX + (others.length - 1) * FILE_ROW_GAP;
  return grid + list + (grid && list ? ATTACHMENT_GAP : 0);
}

function bubbleTextLines(body: string): number {
  return Math.max(1, Math.ceil(graphemes(body.trim()).length / CHARS_PER_LINE));
}

export function estimateRowHeight(item: TimelineItem): number {
  if (item.kind === "event" && item.message.event?.kind === "run_error") return RUN_ERROR_ROW_PX;
  if (item.kind === "day-divider" || item.kind === "unread-divider" || item.kind === "event" || item.kind === "thread") return EVENT_ROW_PX;

  const { message } = item;
  const attachments = attachmentsHeight(message);
  const hasText = message.body.length > 0;
  const jumbo = attachments > 0 ? undefined : jumboEmojiClass(message.body);
  const text = hasText || attachments === 0 ? LINE_BOX * bubbleTextLines(message.body) : 0;
  const bubble =
    jumbo === "jumbo-single"
      ? JUMBO_SINGLE_PX
      : jumbo === "jumbo-group"
        ? JUMBO_GROUP_PX
        : BUBBLE_PAD_Y + attachments + (attachments && hasText ? ATTACHMENT_GAP : 0) + text;
  const quote = message.replyToId === undefined ? 0 : QUOTE_LINE * QUOTE_LINES + QUOTE_CHROME_Y;

  const fold = currentLimit();
  const shown = bubble > fold + FOLD_BUTTON_PX ? fold + FOLD_BUTTON_PX : bubble;

  const rowPadTop = item.hasRunGapBefore ? RUN_GAP_PX : ROW_GAP_PX;
  return Math.ceil(shown + quote + rowPadTop + ROW_GAP_PX);
}
