import type { ChatMessage } from "../../lib/types";
import { startsTimeBreak } from "./time-label";

/** Telegram's run window. A gap strictly larger than this splits a run. */
export const MESSAGE_GROUPING_WINDOW_MS = 300_000;

/** A senderless line in a group: "kiko joined". Placed by the room's `seq`. */
export type Notice = { key: string; seq: number; at: number; text: string };

export type TimelineItem =
  | {
      kind: "day-divider";
      key: string;
      /** Local midnight of the day, used for labels and the date chip. */
      dayStart: number;
      /** The first message in that day. The divider shows ITS clock time, not
       *  midnight: kat's separator reads `today 11:23 am`, and `12:00 am` on
       *  every divider is a label that says nothing. */
      firstSentAt: number;
    }
  | { kind: "unread-divider"; key: string; afterMessageId: string }
  | { kind: "notice"; key: string; at: number; text: string }
  | {
      /** Agents talking to each other, folded into one muted line. Expanded, its messages follow it. */
      kind: "thread";
      key: string;
      messages: readonly ChatMessage[];
      /** The agents in it, in the order they first spoke. */
      slugs: readonly string[];
      expanded: boolean;
    }
  | {
      kind: "message";
      key: string;
      message: ChatMessage;
      /** The id of the first message of this run. */
      runKey: string;
      /** 0-based position inside the run. */
      runIndex: number;
      /** Messages sharing this run, including this one. */
      runSize: number;
      isRunStart: boolean;
      isRunEnd: boolean;
      /** True when this row does not continue the row above it. */
      hasRunGapBefore: boolean;
    };

export type TimelineOptions = {
  /** Member joins and leaves, by `seq`. */
  notices?: readonly Notice[];
  /**
   * A group's member slugs. With it, agent messages addressed to another agent fold into
   * threads. Without it (a one-agent room) nothing folds.
   */
  members?: ReadonlySet<string>;
  /** The keys of the threads the reader opened. */
  expanded?: ReadonlySet<string>;
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
 * The agent another agent's message opens by addressing, or undefined.
 *
 * ASSUMPTION: the client cannot see a message's hop count, so "agent to agent" is read from
 * the text: an agent's message that starts with `@<another member>` is spoken to that agent,
 * not to the human. A growing draft is never folded, since its first word may still change.
 */
export function addressee(message: ChatMessage, members: ReadonlySet<string>): string | undefined {
  if (message.sender !== "bot" || message.id.startsWith("draft:")) return undefined;
  const slug = /^\s*@([a-z0-9-]{1,32})(?![\w-])/i.exec(message.body)?.[1]?.toLowerCase();
  return slug !== undefined && slug !== message.botId && members.has(slug) ? slug : undefined;
}

type Entry =
  | { kind: "message"; message: ChatMessage; inThread: boolean }
  | { kind: "notice"; notice: Notice }
  | { kind: "thread"; key: string; messages: ChatMessage[]; slugs: string[]; expanded: boolean };

const order = (m: ChatMessage) => m.seq ?? Number.POSITIVE_INFINITY;

/** Messages and notices in `seq` order, with agent-to-agent stretches folded into threads. */
function entries(messages: readonly ChatMessage[], options: TimelineOptions): Entry[] {
  const notices = [...(options.notices ?? [])].sort((a, b) => a.seq - b.seq);
  const out: Entry[] = [];
  let n = 0;
  let thread: Extract<Entry, { kind: "thread" }> | null = null;
  const close = () => {
    if (!thread) return;
    out.push(thread);
    if (thread.expanded) for (const message of thread.messages) out.push({ kind: "message", message, inThread: true });
    thread = null;
  };
  for (const message of messages) {
    while (n < notices.length && notices[n].seq < order(message)) {
      close();
      out.push({ kind: "notice", notice: notices[n++] });
    }
    const to = options.members ? addressee(message, options.members) : undefined;
    if (to === undefined) {
      close();
      out.push({ kind: "message", message, inThread: false });
      continue;
    }
    if (!thread) {
      const key = `thread:${message.id}`;
      thread = { kind: "thread", key, messages: [], slugs: [], expanded: options.expanded?.has(key) ?? false };
    }
    thread.messages.push(message);
    for (const slug of [message.botId!, to]) if (!thread.slugs.includes(slug)) thread.slugs.push(slug);
  }
  close();
  while (n < notices.length) out.push({ kind: "notice", notice: notices[n++] });
  return out;
}

const entryTime = (e: Entry): number =>
  e.kind === "message" ? e.message.sentAt : e.kind === "notice" ? e.notice.at : e.messages[0].sentAt;

/**
 * Walks messages oldest-first and interleaves the dividers the thread needs.
 *
 * `firstUnreadMessageId` names the read cursor's first unseen message. The rule
 * is only placed for an incoming message that has something below it: the
 * viewer never gets an unread rule for their own words, and a rule under the
 * final message marks nothing.
 *
 * A notice or a thread line between two messages ends the run above it, the way a
 * service message does in Telegram. Messages inside an open thread run among themselves.
 */
export function buildTimelineItems(
  messages: readonly ChatMessage[],
  firstUnreadMessageId?: string | null,
  options: TimelineOptions = {},
): TimelineItem[] {
  const list = entries(messages, options);
  const n = list.length;
  if (n === 0) return [];

  const continues = (i: number) => {
    const a = list[i - 1];
    const b = list[i];
    return (
      i > 0 &&
      a.kind === "message" &&
      b.kind === "message" &&
      a.inThread === b.inThread &&
      canGroup(a.message, b.message)
    );
  };
  // runStarts[i] is the index of the first entry in i's run. One pass is
  // enough because grouping is left-associative: i either continues i - 1 or
  // opens a run.
  const runStarts: number[] = new Array(n);
  for (let i = 0; i < n; i += 1) runStarts[i] = continues(i) ? runStarts[i - 1] : i;
  // runEnds[i] is the LAST index sharing i's run, so it resolves right to
  // left: an index only ends its run when the next one opens a new one.
  const runEnds: number[] = new Array(n);
  for (let i = n - 1; i >= 0; i -= 1) {
    runEnds[i] = i + 1 < n && runStarts[i + 1] === runStarts[i] ? runEnds[i + 1] : i;
  }
  const lastMessage = list.findLastIndex((e) => e.kind === "message");

  const items: TimelineItem[] = [];
  for (let i = 0; i < n; i += 1) {
    const entry = list[i];
    const at = entryTime(entry);
    const dayStart = dayStartOf(at);

    if (i > 0 && startsTimeBreak(entryTime(list[i - 1]), at)) {
      const newDay = dayStartOf(entryTime(list[i - 1])) !== dayStart;
      const id = entry.kind === "message" ? entry.message.id : entry.kind === "notice" ? entry.notice.key : entry.key;
      items.push({
        kind: "day-divider",
        // A pause inside a day is keyed by the entry it sits above.
        key: newDay ? `day:${dayStart}` : `gap:${id}`,
        dayStart,
        firstSentAt: at,
      });
    }
    if (entry.kind === "notice") {
      items.push({ kind: "notice", key: `notice:${entry.notice.key}`, at, text: entry.notice.text });
      continue;
    }
    if (entry.kind === "thread") {
      items.push({ kind: "thread", key: entry.key, messages: entry.messages, slugs: entry.slugs, expanded: entry.expanded });
      continue;
    }
    const message = entry.message;
    if (
      firstUnreadMessageId != null &&
      message.id === firstUnreadMessageId &&
      message.sender !== "user" &&
      i < lastMessage
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
    const start = list[runStarts[i]];
    items.push({
      kind: "message",
      key: `msg:${message.id}`,
      message,
      runKey: start.kind === "message" ? start.message.id : message.id,
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
