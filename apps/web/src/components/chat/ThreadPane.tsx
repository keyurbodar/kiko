// components/chat/ThreadPane.tsx — tight iMessage-style timeline (grouping
// patterns from refs/akeru-bot MessagesTimeline.tsx, MIT), stripped of its
// store/state layer. Same props in/out as thread/Thread.tsx
// (turns/pending/conn/onRetry) plus the roster bots list for sender labels /
// mention chips. avatarSlot feeds the working ActivityRow (resolved per-turn
// from senderId, shell slot as fallback); settled bubbles stay avatar-free
// so App needs no change.
// Renders the pure mapper.turnToItems view-model list over a
// StickToBottom-style viewport: pinned follow while new content lands, an
// isAtBottom-gated jump pill, a thinking-dots activity row while the last
// turn streams, a retry row on failed turns, day-aware time dividers between
// turns that gap by more than 20 minutes, and centered system rows.
//
// Grouping: consecutive message bubbles from the same side (user/bot) whose
// timestamps land within GROUP_GAP_MS render as one visual group — 2px gaps
// inside the group, 16px (pb-4) between rows, and a hover- or focus-revealed
// timestamp beneath each settled bubble.
// Every message is a bubble, both sides: the user's right-aligns on bg-message,
// the agent's left-aligns on bg-card, and each hugs its own content up to 80%
// of the column. The column itself is full-bleed (no avatars) and centered at
// max-w-3xl.
//
// Working state: while the tail turn streams the timeline shows the working
// ActivityRow — the responsible bot's avatar (turn.senderId resolved via
// bots, shell avatarSlot as fallback) wearing a shimmer sheen beside the
// thinking dots. The streaming caret, ThinkingReasoning output, StepMeter,
// and tool StatusCards stay out of the default path — ThinkingReasoning and
// StatusCard components (and their mapper branches) still render, but only
// when the turn errored or halted. The working row unmounts whole on settle, so
// settled bubbles land avatar-free and animate in with .msg-pop (user
// bubbles also .msg-pop-user).
//
// Windowing: past VIRTUALIZE_AFTER turns the timeline renders only the
// visible block slice plus 400px overscan (measured block heights, estimated
// until measured, spacers above/below). Short threads render whole, so
// existing pin behavior is untouched.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDown,
  CheckIcon,
  ChevronDown,
  CopyIcon,
  InboxIcon,
  MessageCircleIcon,
  RotateCcw,
} from "lucide-react";
import type { RosterBot } from "../../lib/roster";
import { BotAvatar } from "../roster";
import type { ConnState, PendingPrompt, TurnViewState } from "../thread/types";
import type { AttachmentVM } from "../thread/viewModel";
import {
  turnToItems,
  type ChatItemVM,
  type InboxEventVM,
  type SenderMessageBubbleVM,
  type SystemEventVM,
} from "./mapper";
import { ThinkingReasoning } from "../aicss/ThinkingReasoning";
import { ActivityRow } from "./ActivityRow";
import { ApprovalCard } from "./ApprovalCard";
import { DelegationCard } from "./DelegationCard";
import { InterBotDivider } from "./InterBotDivider";
import { KeyRequiredRow } from "./KeyRequiredRow";
import { Lightbox } from "./Lightbox";
import { MessageBubble, type BubbleStackGroup } from "./MessageBubble";
import { StatusCard } from "./StatusCard";
import { UserInputCard } from "./UserInputCard";

const MemoMessageBubble = memo(MessageBubble);

/** Distance in px from the bottom that still counts as pinned. */
const PIN_THRESHOLD = 64;

function WorkingFace({ bot }: { bot: RosterBot }) {
  return <BotAvatar name={bot.name} src={bot.avatarImage} size={36} />;
}
/** Consecutive turns gap by more than this before a time divider renders. */
const DIVIDER_GAP_MS = 20 * 60_000;
/** Consecutive same-side bubbles gap by this (or less) to share one group. */
const GROUP_GAP_MS = 5 * 60_000;
/** Turn count past which the timeline windows to the visible slice. */
const VIRTUALIZE_AFTER = 20;
/** Rendered margin above/below the viewport while windowed. */
const OVERSCAN_PX = 400;
/** Height guess per block until measured (layout effect corrects it). */
const EST_BLOCK_PX = 120;
export const COMPOSER_OVERLAY_SEED_PX = 96;

/**
 * Day-aware divider label (akeru formatDayAwareTimestamp pattern, local
 * calendar days): same-day "3:46 AM", "Yesterday 3:46 AM", else the
 * weekday plus time.
 */
function formatDividerTime(ts: number, nowMs: number): string {
  const date = new Date(ts);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  // Round so DST-shifted 23/25-hour days still count as whole days.
  const dayDiff = Math.round((startOfToday - startOfDay) / 86_400_000);
  if (dayDiff <= 0) return time;
  if (dayDiff === 1) return `Yesterday ${time}`;
  const weekday = date.toLocaleDateString(undefined, { weekday: "long" });
  return `${weekday} ${time}`;
}

/** Message meta timestamp: time for today, date plus time otherwise ("9/7 8:15 PM"). */
function formatMessageTime(ts: number): string {
  const date = new Date(ts);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === new Date().toDateString()) return time;
  return `${date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" })} ${time}`;
}

/** t3-style meta row under a settled message: copy button plus wall-clock
 * time (date included once the message is not from today). Hidden until the
 * message row is hovered or holds focus; the parent row carries the `group`
 * class. */
export function MessageMeta({
  text,
  ts,
  side,
}: {
  text: string;
  ts: number | null;
  side: "start" | "end";
}) {
  const [copied, setCopied] = useState(false);
  if (ts === null) return null;
  const copy = () => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };
  return (
    <div
      className={`flex items-center gap-1.5 pb-0.5 text-caption-1 tabular-nums opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 ${side === "end" ? "justify-end pr-1" : "justify-start pl-1"}`}
    >
      <button
        type="button"
        data-testid="msg-copy-time"
        aria-label="Copy message"
        onClick={copy}
        className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
      >
        {copied ? (
          <CheckIcon aria-hidden className="size-3" />
        ) : (
          <CopyIcon aria-hidden className="size-3" />
        )}
      </button>
      <span className="whitespace-nowrap text-muted-foreground">{formatMessageTime(ts)}</span>
    </div>
  );
}

/**
 * Aggregate raw turn reactions ({ emoji, by }[]) into the counted shape the
 * bubble reaction row renders ({ emoji, count, mine }). No identity info is
 * available in this track, so mine defaults to false.
 */
type AggregatedReactions = { emoji: string; count: number; mine: boolean }[];

const aggregatedByRaw = new WeakMap<{ emoji: string; by: string }[], AggregatedReactions>();

const itemsByTurn = new WeakMap<
  TurnViewState,
  { bots: RosterBot[]; threadNames: Record<string, string> | undefined; items: ChatItemVM[] }
>();

function aggregateReactions(raw: { emoji: string; by: string }[]): AggregatedReactions {
  const cached = aggregatedByRaw.get(raw);
  if (cached !== undefined) return cached;
  const counts = new Map<string, number>();
  for (const reaction of raw) {
    counts.set(reaction.emoji, (counts.get(reaction.emoji) ?? 0) + 1);
  }
  const aggregated = [...counts].map(([emoji, count]) => ({ emoji, count, mine: false }));
  aggregatedByRaw.set(raw, aggregated);
  return aggregated;
}

/** True for the error path, where ThinkingReasoning/StatusCard rows stay visible. */
function isErrorPath(turn: TurnViewState): boolean {
  return turn.status === "error" || turn.halt !== null;
}

function groupGapOk(prev: number | null, next: number | null): boolean {
  // Replayed history carries no wall clock (ts null): treat it as
  // in-group so same-side bubbles still merge into one visual group.
  if (prev === null || next === null) return true;
  return Math.abs(next - prev) <= GROUP_GAP_MS;
}

const noopAnswer = (_id: string, _answer: string): void => {};
const noopDecision = (_id: string, _decision: "approved" | "rejected"): void => {};
const noopOpenGroup = (_threadId: string): void => {};

interface GroupBubble {
  turn: TurnViewState;
  item: SenderMessageBubbleVM;
}

interface BubbleGroup {
  key: string;
  role: "user" | "bot";
  bubbles: GroupBubble[];
  /** Timestamp of the latest bubble; null while streaming. */
  ts: number | null;
}

interface TimelineBlock {
  key: string;
  node: ReactNode;
  /** Row gap (padding-bottom) carried by the block wrapper. */
  pad: string;
}

export function ThreadPane({
  turns,
  pending,
  conn,
  onRetry,
  avatarSlot = null,
  bots = [],
  threadNames,
  playing = false,
  onEdit: _onEdit,
  onAnswer = noopAnswer,
  onDecision = noopDecision,
  onOpenGroup = noopOpenGroup,
  renderComposer,
}: {
  turns: TurnViewState[];
  pending: PendingPrompt[];
  conn: ConnState;
  onRetry: (prompt: string) => void;
  /** Injected by the shell (BotAvatar); null renders the bare bubble. */
  avatarSlot?: ReactNode;
  /** Roster bots for sender labels, mention chips, and inter-bot dividers. */
  bots?: RosterBot[];
  /** Group id to display name, for inbox chips. */
  threadNames?: Record<string, string>;
  playing?: boolean;
  onEdit?: (text: string) => void;
  /** Called with a user-input card's answer; default no-op (card marks answered locally). */
  onAnswer?: (id: string, answer: string) => void;
  /** Called with an approval card's decision; default no-op (card flips locally). */
  onDecision?: (id: string, decision: "approved" | "rejected") => void;
  /** Opens a group thread from an inbox peek's jump link. */
  onOpenGroup?: (threadId: string) => void;
  renderComposer: (onOverlayHeightChange: (height: number) => void) => ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overlayHeight, setOverlayHeight] = useState(COMPOSER_OVERLAY_SEED_PX);
  const composer = useMemo(
    () => renderComposer(setOverlayHeight),
    [renderComposer, setOverlayHeight],
  );
  const [atBottom, setAtBottom] = useState(true);
  const [lightbox, setLightbox] = useState<AttachmentVM | null>(null);
  const viewportRef = useRef({ top: 0, height: 800 });
  const [slice, setSlice] = useState({ start: 0, end: 0 });
  const heightsRef = useRef(new Map<string, number>());
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  const [, setMeasTick] = useState(0);
  const smoothScrollRef = useRef(false);
  const handleScrollRef = useRef<() => void>(() => {});
  const scrollFrameRef = useRef(0);
  const sliceSyncRef = useRef({ windowing: false, count: -1 });

  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    const el = scrollRef.current;
    if (el !== null) el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    const sync = () => handleScrollRef.current();
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  // Pinned follow: fresh content pulls the viewport down while stuck; suppressed while the pill's programmatic smooth scroll is in flight.
  useEffect(() => {
    if (atBottom && !smoothScrollRef.current) scrollToBottom("auto");
  });

  const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;
  const empty = turns.length === 0 && pending.length === 0 && !playing;
  // Working avatar for the tail turn: senderId resolved via the roster
  // (fixture multi-sender turns included); the shell active-bot slot is the
  // 1:1 fallback.
  const workingBot =
    lastTurn?.senderId !== undefined ? bots.find((bot) => bot.id === lastTurn.senderId) : undefined;
  const workingAvatar =
    workingBot !== undefined ? (
      <WorkingFace key={workingBot.avatarImage ?? workingBot.id} bot={workingBot} />
    ) : (
      avatarSlot
    );
  // GROUP_GAP_MS merge into one BubbleGroup (even across turn boundaries);
  // every other item renders as its own block. ThinkingReasoning and tool
  // StatusCard rows only survive on the error path.
  const blocks = useMemo(() => {
    const shared = { avatarSlot, bots, onAnswer, onDecision };
    const itemsForTurn = (turn: TurnViewState): ChatItemVM[] => {
      const cached = itemsByTurn.get(turn);
      if (cached !== undefined && cached.bots === bots && cached.threadNames === threadNames) {
        return cached.items;
      }
      const items = turnToItems(turn, bots, threadNames);
      itemsByTurn.set(turn, { bots, threadNames, items });
      return items;
    };
    const built: TimelineBlock[] = [];
    let group: BubbleGroup | null = null;
    const groupInboxCount = new Map<string, number>();
    for (const turn of turns) {
      for (const msg of turn.inbox ?? []) {
        if (msg.thread !== null)
          groupInboxCount.set(msg.thread, (groupInboxCount.get(msg.thread) ?? 0) + 1);
      }
    }
    const groupInbox = new Map<string, null>();
    const flushGroup = () => {
      if (group === null) return;
      const current = group;
      group = null;
      built.push({
        key: current.key,
        pad: "pb-4",
        node: (
          <BubbleGroupView
            group={current}
            avatarSlot={avatarSlot}
            bots={bots}
            onOpenImage={setLightbox}
            onAnswer={onAnswer}
            onDecision={onDecision}
          />
        ),
      });
    };

    turns.forEach((turn, turnIndex) => {
      const ts = turn.startedAt ?? turn.endedAt;
      const prevTurn = turnIndex > 0 ? turns[turnIndex - 1] : null;
      const prevTs = prevTurn !== null ? (prevTurn.startedAt ?? prevTurn.endedAt) : null;
      const showDivider = ts !== null && prevTs !== null && ts - prevTs > DIVIDER_GAP_MS;
      const errorPath = isErrorPath(turn);
      if (showDivider && ts !== null) {
        flushGroup();
        built.push({
          key: `divider:${turn.runId}`,
          pad: "pb-4",
          node: (
            <div
              data-testid="time-divider"
              className="flex items-center gap-3 py-1 text-caption-1 text-muted-foreground"
              role="separator"
            >
              <span aria-hidden className="h-px min-w-4 flex-1 bg-border/70" />
              <span>{formatDividerTime(ts, Date.now())}</span>
              <span aria-hidden className="h-px min-w-4 flex-1 bg-border/70" />
            </div>
          ),
        });
      }
      for (const item of itemsForTurn(turn)) {
        // A keyless turn's agent content is stub output: only the user's own
        // prompt bubble renders; the key-required notice lands after the loop.
        if (turn.keyless && !("role" in item && item.role === "user")) continue;
        if ("kind" in item && item.kind === "thinking") {
          if (!errorPath) continue;
          flushGroup();
          built.push({
            key: `row:${item.id}`,
            pad: "pb-1.5",
            node: (
              <ChatItem item={item} {...shared} onOpenImage={setLightbox} />
            ),
          });
          continue;
        }
        if ("role" in item) {
          const bubble = item as SenderMessageBubbleVM;
          const bubbleTs = bubble.ts ?? turn.startedAt ?? turn.endedAt ?? null;
          if (group !== null && (group.role !== bubble.role || !groupGapOk(group.ts, bubbleTs))) {
            flushGroup();
          }
          if (group === null) {
            group = { key: `group:${bubble.id}`, role: bubble.role, bubbles: [], ts: null };
          }
          group.bubbles.push({ turn, item: bubble });
          group.ts = bubbleTs;
          continue;
        }
        // StatusCards (tool activity) only survive on the error path; every
        // other row (system, delegation, inter-bot, approval, user input,
        // error/halt cards) always renders.
        if ("rows" in item && !errorPath) continue;
        if ("kind" in item && item.kind === "inbox") {
          flushGroup();
          const direct = item.messages.filter((msg) => msg.threadId === null);
          if (direct.length > 0) {
            built.push({
              key: `row:${item.id}`,
              pad: "pb-4",
              node: (
                <InboxRow
                  vm={{ ...item, messages: direct }}
                  bots={bots}
                  threadNames={threadNames}
                  onOpenGroup={onOpenGroup}
                />
              ),
            });
          }
          for (const threadId of new Set(
            item.messages.map((msg) => msg.threadId).filter((t): t is string => t !== null),
          )) {
            if (groupInbox.has(threadId) || threadNames?.[threadId] === undefined) continue;
            groupInbox.set(threadId, null);
            built.push({
              key: `row:${item.id}:g:${threadId}`,
              pad: "pb-4",
              node: (
                <GroupActivityLine
                  threadId={threadId}
                  count={groupInboxCount.get(threadId) ?? 0}
                  threadNames={threadNames}
                  onOpenGroup={onOpenGroup}
                />
              ),
            });
          }
          continue;
        }
        flushGroup();
        built.push({
          key: `row:${item.id}`,
          // Tool/status rows sit tight against the message they belong to.
          pad: "rows" in item ? "pb-1.5" : "pb-4",
          node: (
            <ChatItem item={item} {...shared} onOpenImage={setLightbox} />
          ),
        });
      }
      if (turn.keyless) {
        flushGroup();
        built.push({
          key: `keyless:${turn.runId}`,
          pad: "pb-4",
          node: <KeyRequiredRow runId={turn.runId} onRetry={() => onRetry(turn.prompt)} />,
        });
      }
      // A keyless turn already carries the cause and the retry action, so the
      // generic failed/interrupted card would only repeat it.
      if (!turn.keyless && (turn.status === "error" || turn.status === "interrupted")) {
        flushGroup();
        built.push({
          key: `retry:${turn.runId}`,
          pad: "pb-4",
          node: (
            <div
              role="alert"
              className="flex items-center gap-2 px-1 text-caption-1 text-muted-foreground"
            >
              <RotateCcw aria-hidden className="size-3.5 shrink-0" />
              <span>{turn.status === "interrupted" ? "Turn interrupted." : "Turn failed."}</span>
              <button
                type="button"
                data-testid={`retry-${turn.runId}`}
                onClick={() => onRetry(turn.prompt)}
                className="cursor-pointer rounded px-1.5 py-0.5 text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              >
                Retry
              </button>
            </div>
          ),
        });
      }
    });
    flushGroup();
    return built;
  }, [turns, bots, threadNames, avatarSlot, onRetry, onAnswer, onDecision, onOpenGroup]);

  // Windowing math (block-level): offsets from measured heights (estimate
  // until measured), visible slice = viewport ± overscan.
  const windowing = turns.length > VIRTUALIZE_AFTER;
  const heights = heightsRef.current;
  const offsets: number[] = new Array(blocks.length);
  let cursor = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    offsets[i] = cursor;
    cursor += heights.get(blocks[i].key) ?? EST_BLOCK_PX;
  }
  const sliceFor = (top: number, height: number) => {
    const viewTop = top - OVERSCAN_PX;
    const viewBottom = top + height + OVERSCAN_PX;
    let s = blocks.length;
    let e = 0;
    for (let i = 0; i < blocks.length; i += 1) {
      const h = heights.get(blocks[i].key) ?? EST_BLOCK_PX;
      if (offsets[i] + h >= viewTop && offsets[i] <= viewBottom) {
        if (i < s) s = i;
        if (i + 1 > e) e = i + 1;
      }
    }
    if (s > blocks.length - 1) {
      s = Math.max(0, blocks.length - 1);
      e = blocks.length;
    }
    return { start: s, end: e };
  };

  const readScroll = () => {
    const el = scrollRef.current;
    if (el === null) return;
    const pinned = el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD;
    if (pinned) smoothScrollRef.current = false;
    setAtBottom(pinned);
    viewportRef.current = { top: el.scrollTop, height: el.clientHeight };
    if (!windowing) return;
    const next = sliceFor(el.scrollTop, el.clientHeight);
    setSlice((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  };
  handleScrollRef.current = readScroll;

  const handleScroll = () => {
    if (scrollFrameRef.current !== 0) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = 0;
      handleScrollRef.current();
    });
  };

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== 0) cancelAnimationFrame(scrollFrameRef.current);
    },
    [],
  );
  // Re-sync the slice only on windowing flip or block-count change; height corrections are slice outputs and must not retrigger it (feedback loop).
  useLayoutEffect(() => {
    if (!windowing) {
      sliceSyncRef.current = { windowing: false, count: -1 };
      return;
    }
    const last = sliceSyncRef.current;
    if (last.windowing && last.count === blocks.length) return;
    sliceSyncRef.current = { windowing: true, count: blocks.length };
    const next = sliceFor(viewportRef.current.top, viewportRef.current.height);
    setSlice((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  });

  let start = 0;
  let end = blocks.length;
  let topPad = 0;
  let bottomPad = 0;
  if (windowing) {
    start = Math.min(slice.start, Math.max(0, blocks.length - 1));
    end = Math.max(Math.min(slice.end, blocks.length), start + (blocks.length > 0 ? 1 : 0));
    topPad = start > 0 ? offsets[start] : 0;
    const endOffset = end < blocks.length ? offsets[end] : cursor;
    bottomPad = cursor - endOffset;
  }

  // Measure rendered block nodes; estimates converge to real heights so the
  // spacers (and scroll position) stay stable.
  useLayoutEffect(() => {
    let changed = false;
    for (const [key, el] of nodeRefs.current) {
      if (!el.isConnected) continue;
      const h = el.offsetHeight;
      const prev = heights.get(key);
      if (prev === undefined || Math.abs(prev - h) > 2) {
        heights.set(key, h);
        changed = true;
      }
    }
    if (changed) setMeasTick((tick: number) => tick + 1);
  }, [heights, blocks, windowing, slice.start, slice.end]);

  const renderBlock = (block: TimelineBlock) => {
    if (!windowing) return <div key={block.key} className={block.pad}>{block.node}</div>;
    return (
      <div
        key={block.key}
        className={block.pad}
        ref={(el) => {
          if (el !== null) nodeRefs.current.set(block.key, el);
          else nodeRefs.current.delete(block.key);
        }}
      >
        {block.node}
      </div>
    );
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        data-testid="thread-viewport"
        className="h-full overflow-y-auto overflow-x-hidden px-3 pt-[var(--workspace-topbar-height)] sm:px-5"
      >
        <div
          className="mx-auto flex w-full min-w-0 max-w-3xl flex-col pt-3"
          style={{ paddingBottom: overlayHeight }}
        >
          {empty && (
            <p className="py-12 text-center text-body text-placeholder">
              {conn === "connecting"
                ? "Connecting…"
                : "New session ready — send a prompt to start."}
            </p>
          )}
          {/* Fixture playback of a fresh session (fixture runIds, no live turn yet): blue NEW above the first group. */}
          {playing &&
            blocks.length > 0 &&
            turns.every((turn) => turn.runId.startsWith("fixture:")) && (
              <div
                data-testid="new-divider"
                className="flex items-center gap-3 py-1 text-caption-1 font-medium text-info"
                role="separator"
                aria-label="New"
              >
                <span aria-hidden className="h-px min-w-4 flex-1 bg-info/40" />
                <span>NEW</span>
                <span aria-hidden className="h-px min-w-4 flex-1 bg-info/40" />
              </div>
            )}
          {windowing && topPad > 0 && <div aria-hidden style={{ height: topPad }} />}
          {windowing
            ? blocks.slice(start, end).map((block) => renderBlock(block))
            : blocks.map((block) => renderBlock(block))}
          {windowing && bottomPad > 0 && <div aria-hidden style={{ height: bottomPad }} />}
          {lastTurn?.status === "streaming" && (
            <div className="pb-1.5">
              <ActivityRow avatarSlot={workingAvatar} name={workingBot?.name} />
            </div>
          )}
          {pending.map((p) => (
            <div key={p.id} className="group flex w-full flex-col items-end pb-4">
              <MemoMessageBubble
                vm={{
                  id: `pending:${p.id}`,
                  role: "user",
                  text: p.text,
                  attachments: [],
                  ts: null,
                }}
                bots={bots}
                onOpenImage={setLightbox}
                enterClassName="msg-pop msg-pop-user"
              />
            </div>
          ))}
        </div>
      </div>
      <JumpToLatest
        visible={!atBottom}
        bottomOffset={overlayHeight}
        onJump={() => {
          smoothScrollRef.current = true;
          setAtBottom(true);
          scrollToBottom("smooth");
        }}
      />
      {lightbox !== null && <Lightbox attachment={lightbox} onClose={() => setLightbox(null)} />}
      {composer}
    </div>
  );
}

/**
 * One visual group: every bubble — human and agent — is a bubble, right-aligned
 * for the user and left-aligned for agents, hugging its own content and capped
 * at 80% of the column. Hovering a settled bubble reveals its t3-style meta row
 * (copy plus wall-clock) beneath it. Settled bubbles pop in (.msg-pop, plus
 * .msg-pop-user on the user side).
 */
function BubbleGroupView({
  group,
  avatarSlot,
  bots,
  onOpenImage,
  onAnswer,
  onDecision,
}: {
  group: BubbleGroup;
  avatarSlot: ReactNode;
  bots: RosterBot[];
  onOpenImage: (attachment: AttachmentVM) => void;
  onAnswer: (id: string, answer: string) => void;
  onDecision: (id: string, decision: "approved" | "rejected") => void;
}) {
  const isUser = group.role === "user";
  const count = group.bubbles.length;
  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"} gap-[2px]`}>
      {group.bubbles.map(({ turn, item }, index) => {
        const stack: BubbleStackGroup | undefined =
          count === 1
            ? undefined
            : index === 0
              ? "first"
              : index === count - 1
                ? "last"
                : "middle";
        const settled = turn.status !== "streaming";
        const pop = settled ? (isUser ? "msg-pop msg-pop-user" : "msg-pop") : "";
        const bubbleTs = item.ts ?? turn.startedAt ?? turn.endedAt ?? null;
        return (
          <div
            key={item.id}
            className={`group flex w-full flex-col ${isUser ? "items-end" : "items-start"} gap-0.5`}
          >
            <ChatItem
              item={item}
              group={stack}
              avatarSlot={!isUser && index === 0 ? avatarSlot : null}
              bots={bots}
              onOpenImage={onOpenImage}
              onAnswer={onAnswer}
              onDecision={onDecision}
              enterClassName={pop}
            />
            {settled && (
              <MessageMeta text={item.text} ts={bubbleTs} side={isUser ? "end" : "start"} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Compact icon-only jump control floating just above the composer. */
export function JumpToLatest({
  visible,
  onJump,
  bottomOffset = 8,
}: {
  visible: boolean;
  onJump: () => void;
  bottomOffset?: number;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-10 flex justify-center"
      style={{ bottom: bottomOffset }}
    >
      {visible && (
        <button
          type="button"
          data-testid="jump-to-latest"
          aria-label="Jump to latest"
          onClick={onJump}
          className="pointer-events-auto flex size-7 items-center justify-center rounded-full border border-border/60 bg-card text-muted-foreground shadow-sm outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        >
          <ArrowDown aria-hidden className="size-4" />
        </button>
      )}
    </div>
  );
}

/** Discriminates the mapper-local rows, the (open) ThreadItemVM union. */
function ChatItem({
  item,
  group,
  avatarSlot: _avatarSlot,
  bots,
  onOpenImage,
  onAnswer,
  onDecision,
  enterClassName,
}: {
  item: Exclude<ChatItemVM, InboxEventVM>;
  avatarSlot: ReactNode;
  group?: BubbleStackGroup;
  bots: RosterBot[];
  enterClassName?: string;
  onOpenImage: (attachment: AttachmentVM) => void;
  onAnswer: (id: string, answer: string) => void;
  onDecision: (id: string, decision: "approved" | "rejected") => void;
}) {
  if ("kind" in item) {
    if (item.kind === "system") return <SystemRow vm={item} />;
    if (item.kind === "thinking") {
      return (
        <div data-testid={`thread-item-${item.id}`}>
          <ThinkingReasoning text={item.text} streaming={item.ms === null} thinkingMs={item.ms} />
        </div>
      );
    }
    if (item.kind === "delegation") return <DelegationCard vm={item} bots={bots} />;
    return <UserInputCard vm={item} onAnswer={onAnswer} />;
  }
  if ("role" in item) {
    const extra = item as SenderMessageBubbleVM;
    // Reply-track props (replyQuote/reactions) land on MessageBubble from
    // the sibling track; spread tolerantly so this compiles with or without
    // them. The streaming caret stays off — the ActivityRow is the only
    // working indicator in the default path.
    const replyProps = {
      ...(extra.replyTo !== undefined ? { replyQuote: extra.replyTo } : {}),
      ...(extra.reactions !== undefined ? { reactions: aggregateReactions(extra.reactions) } : {}),
    };
    const bubbleProps = {
      vm: item,
      streaming: false,
      group,
      senderLabel: "senderLabel" in item ? item.senderLabel : undefined,
      bots,
      onOpenImage,
      enterClassName,
      ...replyProps,
    };
    return (
      <MemoMessageBubble {...(bubbleProps as unknown as Parameters<typeof MessageBubble>[0])} />
    );
  }
  if ("rows" in item) return <StatusCard vm={item} />;
  if ("fromBotIds" in item) return <InterBotDivider vm={item} bots={bots} />;
  return <ApprovalCard vm={item} onDecide={onDecision} />;
}

/** Centered muted system row ("Created routine · Month-end close"). */
function SystemRow({ vm }: { vm: SystemEventVM }) {
  return (
    <div
      data-testid={`thread-item-${vm.id}`}
      className="flex items-center gap-3 py-0.5 text-caption-2 text-muted-foreground"
      role="note"
    >
      <span aria-hidden className="h-px min-w-4 flex-1 bg-border/70" />
      <span className="max-w-[70%] truncate">{vm.text}</span>
      <span aria-hidden className="h-px min-w-4 flex-1 bg-border/70" />
    </div>
  );
}

/** Inbox wake event: the teammate messages that triggered the turn. Quiet
 * one-line rows so the conversation stays visually dominant; each line peeks
 * the full text plus a jump link to the group it came from. Threads with more
 * than INBOX_FOLD_AFTER arrivals collapse each event to a single line. */
function InboxRow({
  vm,
  bots,
  threadNames,
  onOpenGroup,
}: {
  vm: InboxEventVM;
  bots: RosterBot[];
  threadNames?: Record<string, string>;
  onOpenGroup: (threadId: string) => void;
}) {
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const open = expanded ?? vm.messages.length <= INBOX_FOLD_AFTER;
  if (!open) {
    const senders = [...new Set(vm.messages.map((msg) => msg.label))].join(", ");
    return (
      <div data-testid={`thread-item-${vm.id}`} role="note">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-caption-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <InboxIcon aria-hidden className="size-3.5 shrink-0" />
          <span className="shrink-0 font-medium">Inbox · {vm.messages.length}</span>
          <span className="min-w-0 truncate">{senders}</span>
          <ChevronDown aria-hidden className="size-3 shrink-0" />
        </button>
      </div>
    );
  }
  return (
    <div data-testid={`thread-item-${vm.id}`} className="flex flex-col gap-0.5 py-0.5" role="note">
      {vm.messages.map((msg, index) => (
        <WhisperLine
          key={index}
          vm={vm}
          index={index}
          msg={msg}
          bots={bots}
          threadNames={threadNames}
          onOpenGroup={onOpenGroup}
        />
      ))}
    </div>
  );
}

const INBOX_FOLD_AFTER = 10;

/** One quiet arrival line; click toggles the full-text peek. */
function WhisperLine({
  vm,
  index,
  msg,
  bots,
  threadNames,
  onOpenGroup,
}: {
  vm: InboxEventVM;
  index: number;
  msg: InboxEventVM["messages"][number];
  bots: RosterBot[];
  threadNames?: Record<string, string>;
  onOpenGroup: (threadId: string) => void;
}) {
  const [peeked, setPeeked] = useState(false);
  const bot = bots.find((b) => b.id === msg.from);
  const jumpable = msg.threadId !== null && threadNames?.[msg.threadId] !== undefined;

  return (
    <>
      <button
        type="button"
        data-testid={`inbox-line-${vm.id}-${index}`}
        aria-expanded={peeked}
        onClick={() => setPeeked((prev) => !prev)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-0.5 text-left text-caption-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        {bot !== undefined ? (
          <BotAvatar
            name={bot.name}
            src={bot.avatarImage}
            size={18}
            className="shrink-0"
          />
        ) : (
          <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-medium text-muted-foreground">
            {msg.label.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="shrink-0 font-medium text-foreground">{msg.label}</span>
        {msg.thread !== null ? (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-px text-[10px]">
            {msg.thread}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate">{msg.text}</span>
      </button>
      {peeked && (
        <div className="ml-7 flex flex-col gap-1.5 rounded-lg bg-muted px-3 py-2">
          <span className="whitespace-pre-wrap text-caption-1 text-muted-foreground">{msg.text}</span>
          {jumpable && (
            <button
              type="button"
              data-testid={`inbox-jump-${vm.id}-${index}`}
              onClick={() => onOpenGroup(msg.threadId ?? "")}
              className="w-fit cursor-pointer rounded px-0.5 text-caption-2 font-medium text-rose-text hover:underline"
            >
              Open {msg.thread} →
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** One muted pill per group whose traffic reached this bot; click jumps to
 * the group's own thread, the single home of that conversation. */
function GroupActivityLine({
  threadId,
  count,
  threadNames,
  onOpenGroup,
}: {
  threadId: string;
  count: number;
  threadNames?: Record<string, string>;
  onOpenGroup: (threadId: string) => void;
}) {
  const name = threadNames?.[threadId] ?? threadId;
  return (
    <div role="note">
      <button
        type="button"
        data-testid={`group-activity-${threadId}`}
        onClick={() => onOpenGroup(threadId)}
        className="flex w-fit items-center gap-2 rounded-full border border-border/60 bg-muted px-2.5 py-1 text-caption-2 text-muted-foreground hover:border-primary hover:text-foreground"
      >
        <MessageCircleIcon aria-hidden className="size-3.5 shrink-0" />
        <span>
          {count} {count === 1 ? "message" : "messages"} in {name}
        </span>
        <span aria-hidden className="text-accent">
          →
        </span>
      </button>
    </div>
  );
}
