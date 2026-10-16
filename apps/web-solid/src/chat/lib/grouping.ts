import { createSignal, type Setter } from "solid-js";
import type { ChatMessage } from "../../lib/types";
import { eventText } from "./event-line";
import { startsTimeBreak } from "./time-label";

/** Telegram's run window. A gap strictly larger than this splits a run. */
export const MESSAGE_GROUPING_WINDOW_MS = 300_000;

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
  | { kind: "event"; key: string; message: ChatMessage }
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

/** Who an agent's message was sent to: a teammate, "all", or undefined for a reply meant for the human. The room records it. */
const addressee = (message: ChatMessage): string | undefined => (message.sender === "bot" ? message.to : undefined);

type Entry =
  | { kind: "message"; message: ChatMessage; inThread: boolean }
  | { kind: "event"; message: ChatMessage }
  | { kind: "thread"; key: string; messages: ChatMessage[]; slugs: string[]; expanded: boolean };

const visibleMessage = (m: ChatMessage) => !m.event || eventText(m, String) !== null;

const isEvent = (m: ChatMessage) => m.event !== undefined || m.goto !== undefined;

/** Messages and event lines in `seq` order, with agent-to-agent stretches folded into threads. */
function entries(messages: readonly ChatMessage[], options: TimelineOptions): Entry[] {
  const out: Entry[] = [];
  let thread: Extract<Entry, { kind: "thread" }> | null = null;
  const close = () => {
    if (!thread) return;
    out.push(thread);
    if (thread.expanded) for (const message of thread.messages) out.push({ kind: "message", message, inThread: true });
    thread = null;
  };
  for (const message of messages) {
    if (isEvent(message)) {
      close();
      out.push({ kind: "event", message });
      continue;
    }
    const to = options.members ? addressee(message) : undefined;
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
    for (const slug of [message.botId!, to]) if (slug !== "all" && !thread.slugs.includes(slug)) thread.slugs.push(slug);
  }
  close();
  return out;
}

const entryTime = (e: Entry): number =>
  e.kind === "thread" ? e.messages[0].sentAt : e.message.sentAt;

/**
 * Walks messages oldest-first and interleaves the dividers the thread needs.
 *
 * `firstUnreadMessageId` names the read cursor's first unseen message. The rule
 * is only placed for an incoming message that has something below it: the
 * viewer never gets an unread rule for their own words, and a rule under the
 * final message marks nothing.
 *
 * An event line or a thread line between two messages ends the run above it, the way a
 * service message does in Telegram. Messages inside an open thread run among themselves.
 */
export function buildTimelineItems(
  messages: readonly ChatMessage[],
  firstUnreadMessageId?: string | null,
  options: TimelineOptions = {},
): TimelineItem[] {
  const unreadIndex = messages.findIndex((m) => m.id === firstUnreadMessageId);
  if (unreadIndex >= 0 && !visibleMessage(messages[unreadIndex])) {
    firstUnreadMessageId = messages.slice(unreadIndex + 1).find((m) => visibleMessage(m) && m.sender !== "user")?.id;
  }
  const list = entries(messages.filter(visibleMessage), options);
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
      const id = entry.kind === "thread" ? entry.key : entry.message.id;
      items.push({
        kind: "day-divider",
        // A pause inside a day is keyed by the entry it sits above.
        key: newDay ? `day:${dayStart}` : `gap:${id}`,
        dayStart,
        firstSentAt: at,
      });
    }
    if (entry.kind === "event") {
      items.push({ kind: "event", key: `event:${entry.message.id}`, message: entry.message });
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

const sameValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
};

function sameItem(a: TimelineItem, b: TimelineItem): boolean {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  for (const k in x) if (!sameValue(x[k], y[k])) return false;
  for (const k in y) if (!(k in x)) return false;
  return true;
}

type MessageItem = TimelineItem & { kind: "message" };
type Run = Pick<MessageItem, "runKey" | "runIndex" | "runSize" | "isRunStart" | "isRunEnd" | "hasRunGapBefore">;

const runOf = (item: MessageItem): Run => ({
  runKey: item.runKey,
  runIndex: item.runIndex,
  runSize: item.runSize,
  isRunStart: item.isRunStart,
  isRunEnd: item.isRunEnd,
  hasRunGapBefore: item.hasRunGapBefore,
});

const sameRun = (a: Run, b: Run) =>
  a.runKey === b.runKey &&
  a.runIndex === b.runIndex &&
  a.runSize === b.runSize &&
  a.isRunStart === b.isRunStart &&
  a.isRunEnd === b.isRunEnd &&
  a.hasRunGapBefore === b.hasRunGapBefore;

/** The setter of each message row's run fields, so a row can move inside its run in place. */
const moves = new WeakMap<TimelineItem, Setter<Run>>();

/** A message row whose run fields are reactive. */
function live(item: MessageItem): MessageItem {
  const [run, setRun] = createSignal(runOf(item), { equals: sameRun });
  const out: MessageItem = {
    kind: "message",
    key: item.key,
    message: item.message,
    get runKey() { return run().runKey; },
    get runIndex() { return run().runIndex; },
    get runSize() { return run().runSize; },
    get isRunStart() { return run().isRunStart; },
    get isRunEnd() { return run().isRunEnd; },
    get hasRunGapBefore() { return run().hasRunGapBefore; },
  };
  moves.set(out, setRun);
  return out;
}

/**
 * `next` with every item that did not change replaced by the object it had last time.
 *
 * The virtual list keys its rows by object, so a new object for an unchanged message is a
 * row torn down and built again: its menu, its swipe, its bubble, and the entry animation of
 * a bubble that just arrived. Without this, every frame that touched the transcript (a typing
 * change, one new message) rebuilt every visible row.
 *
 * A message whose only change is its place in its run keeps its object too, and its run
 * fields update in place. An agent posts a reply as several bubbles, and each one moves the
 * bubbles above it inside the run; rebuilding them replayed their entry animation, which read
 * as the agent's earlier messages arriving again. `previous` maps key to item and is updated
 * in place.
 */
export function keepUnchanged(previous: Map<string, TimelineItem>, next: TimelineItem[]): TimelineItem[] {
  const out = next.map((item) => {
    const old = previous.get(item.key);
    if (old && sameItem(old, item)) return old;
    if (item.kind !== "message") return item;
    const move = old?.kind === "message" && old.message === item.message ? moves.get(old) : undefined;
    if (!move) return live(item);
    move(runOf(item));
    return old!;
  });
  previous.clear();
  for (const item of out) previous.set(item.key, item);
  return out;
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
