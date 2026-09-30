import type { ChatMessage } from "../../lib/types";

/** Telegram's run window. A gap strictly larger than this splits a run. */
export const MESSAGE_GROUPING_WINDOW_MS = 300_000;

export type TimelineItem =
  | { kind: "day-divider"; key: string; dayStart: number }
  | { kind: "unread-divider"; key: string; afterMessageId: string }
  | {
      kind: "message";
      key: string;
      message: ChatMessage;
      /** 0-based position inside the run. */
      runIndex: number;
      /** Messages sharing this run, including this one. */
      runSize: number;
      isRunStart: boolean;
      isRunEnd: boolean;
      /** True when this row does not continue the row above it. */
      hasRunGapBefore: boolean;
    };

/**
 * Local midnight of the calendar day `sentAt` falls in.
 *
 * Calendar arithmetic, not a 24-hour subtraction: a DST day is 23 or 25 hours
 * long, so `start - 86_400_000` walks into the wrong day twice a year.
 */
export function dayStartOf(sentAt: number): number {
  const d = new Date(sentAt);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Telegram's `canItemsBeGrouped`, reduced to what a text transcript can act on:
 * same sender (and same bot for bots), same calendar day, a non-negative gap
 * inside the window, and neither side answering another message.
 */
export function canGroup(a: ChatMessage, b: ChatMessage): boolean {
  if (a.sender !== b.sender) return false;
  if (a.botId !== b.botId) return false;
  // A reply always opens its own run; it never tucks under the quoted one.
  if (a.replyToId !== undefined || b.replyToId !== undefined) return false;
  if (dayStartOf(a.sentAt) !== dayStartOf(b.sentAt)) return false;
  const gap = b.sentAt - a.sentAt;
  // Negative means the feed is out of order; treat it as a break, not a group.
  return gap >= 0 && gap <= MESSAGE_GROUPING_WINDOW_MS;
}

/**
 * Walks messages oldest-first and interleaves the dividers the thread needs.
 *
 * `firstUnreadMessageId` names the read cursor's first unseen message. The rule
 * is only placed for an incoming message that has something below it: the
 * viewer never gets an unread rule for their own words, and a rule under the
 * final message marks nothing.
 */
export function buildTimelineItems(
  messages: readonly ChatMessage[],
  firstUnreadMessageId?: string | null,
): TimelineItem[] {
  const n = messages.length;
  if (n === 0) return [];

  // runStarts[i] is the index of the first message in i's run. One pass is
  // enough because grouping is left-associative: i either continues i - 1 or
  // opens a run.
  const runStarts: number[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    runStarts[i] = i > 0 && canGroup(messages[i - 1], messages[i]) ? runStarts[i - 1] : i;
  }
  // runEnds[i] is the LAST index sharing i's run, so it resolves right to
  // left: an index only ends its run when the next one opens a new one.
  const runEnds: number[] = new Array(n);
  for (let i = n - 1; i >= 0; i -= 1) {
    runEnds[i] = i + 1 < n && runStarts[i + 1] === runStarts[i] ? runEnds[i + 1] : i;
  }

  const items: TimelineItem[] = [];
  for (let i = 0; i < n; i += 1) {
    const message = messages[i];
    const dayStart = dayStartOf(message.sentAt);

    if (i > 0 && dayStartOf(messages[i - 1].sentAt) !== dayStart) {
      items.push({ kind: "day-divider", key: `day:${dayStart}`, dayStart });
    }
    if (
      firstUnreadMessageId != null &&
      message.id === firstUnreadMessageId &&
      message.sender !== "user" &&
      i < n - 1
    ) {
      items.push({
        kind: "unread-divider",
        key: `unread:${message.id}`,
        afterMessageId: message.id,
      });
    }

    const runIndex = i - runStarts[i];
    const runSize = runEnds[i] - runStarts[i] + 1;
    const isRunStart = runIndex === 0;
    items.push({
      kind: "message",
      key: `msg:${message.id}`,
      message,
      runIndex,
      runSize,
      isRunStart,
      isRunEnd: runIndex === runSize - 1,
      // Same fact as isRunStart, spelled for the row that reads it: the run
      // above either continued or it did not, and the first row of the thread
      // has nothing to continue.
      hasRunGapBefore: isRunStart,
    });
  }
  return items;
}

/** Index of the unread rule for `firstUnreadMessageId`, or -1 when none exists. */
export function firstUnreadIndex(
  items: readonly TimelineItem[],
  firstUnreadMessageId?: string | null,
): number {
  if (firstUnreadMessageId == null) return -1;
  return items.findIndex(
    (item) => item.kind === "unread-divider" && item.afterMessageId === firstUnreadMessageId,
  );
}
