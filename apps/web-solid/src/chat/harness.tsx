// The chat slice's harness: one page, one fixture state, a URL flag to change
// it, and a `window.__chat` handle so a browser can drive the real reactive
// path rather than a mock of it.
//
// Two rules shape this file:
//
//   1. Every write goes through the same props the composed app passes. There is
//      no harness-only rendering path, so what the probes observe is what a user
//      would see. A probe that reads a variable this file set would be testing
//      the harness.
//   2. The app's token chain is imported HERE rather than relied on from
//      main.tsx. The composed app pulls it in through its own entry; a harness
//      mounted on its own page would otherwise render with no tokens at all,
//      and every probe reading a colour or a font size would report a missing
//      stylesheet as a design bug. The slice's own styling arrives with the
//      slice, through MessageList.

import { createMemo, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { BOTS, FIXTURE_STATES, NOW, UNREAD_ANCHOR_ID, VIEWER_ID } from "../lib/fixtures";
import type { ChatMessage, Reaction, RosterBot } from "../lib/types";
import { MessageList, type VirtualThreadState } from "./MessageList";
import "../styles/app.css";

/** The state the page falls back to when the flag is missing or unknown. */
const DEFAULT_STATE = "today";

const SLUGS = Object.keys(FIXTURE_STATES);

/**
 * Resolve a slug, refusing silently-wrong input. An unknown flag falls back to
 * the default rather than rendering nothing, but it says so in the bar: a typo
 * in a URL should be obvious on the page, not a blank transcript.
 */
function resolveSlug(raw: string | null): { slug: string; known: boolean } {
  if (raw && raw in FIXTURE_STATES) return { slug: raw, known: true };
  return { slug: DEFAULT_STATE, known: raw === DEFAULT_STATE || raw === null };
}

const params = new URLSearchParams(globalThis.location?.search ?? "");
const initial = resolveSlug(params.get("state"));

const [slug, setSlug] = createSignal(initial.slug);
const [unknownFlag, setUnknownFlag] = createSignal(
  params.get("state") !== null && !initial.known,
);
const [typingNames, setTypingNames] = createSignal<readonly string[]>(
  params.get("typing") ? params.get("typing")!.split(",").filter(Boolean) : [],
);
/** The message the reply is aimed at; null means none. */
const [replyTargetId, setReplyTargetId] = createSignal<string | null>(null);
/** Set by the menu/picker openers so a probe can tell a real open from a no-op. */
const [openOverlay, setOpenOverlay] = createSignal<"menu" | "picker" | null>(null);
/** The last scroll state the shell reported, for scroll-anchoring checks. */
const [threadState, setThreadState] = createSignal<VirtualThreadState | null>(null);

/**
 * Reactions the viewer changed on this page, by message id. The harness has no
 * room behind it, so a tap changes these chips and nothing else. The app sends
 * the same tap to the room through `useApp.toggleReaction`.
 */
const [reacted, setReacted] = createSignal<ReadonlyMap<string, Reaction[]>>(new Map());

function toggleReaction(message: ChatMessage, emoji: string) {
  const chips = (reacted().get(message.id) ?? message.reactions ?? []).map((chip) => ({ ...chip }));
  const chip = chips.find((c) => c.emoji === emoji);
  const next = !chip
    ? [...chips, { emoji, count: 1, viewerReacted: true }]
    : chip.viewerReacted
      ? chip.count > 1
        ? chips.map((c) => (c === chip ? { ...c, count: c.count - 1, viewerReacted: false } : c))
        : chips.filter((c) => c !== chip)
      : chips.map((c) => (c === chip ? { ...c, count: c.count + 1, viewerReacted: true } : c));
  setReacted((map) => new Map(map).set(message.id, next));
}

const messages = createMemo<readonly ChatMessage[]>(() => {
  const base = FIXTURE_STATES[slug()] ?? FIXTURE_STATES[DEFAULT_STATE];
  const changed = reacted();
  return changed.size === 0
    ? base
    : base.map((message) => {
        const reactions = changed.get(message.id);
        return reactions ? { ...message, reactions } : message;
      });
});

/** Lookup maps, built once. The transcript only ever reads from these. */
const botById: ReadonlyMap<string, RosterBot> = new Map(
  BOTS.map((bot) => [bot.id, bot] as const),
);

/**
 * The message a reply quotes. Read from the same array the shell renders, so a
 * parent outside the current state resolves to nothing rather than to a row that
 * is not on screen — which is the case a harness must not paper over.
 */
const byId = createMemo(() => new Map(messages().map((message) => [message.id, message])));

const firstUnreadMessageId = createMemo<string | null>(() =>
  slug() === "unread" ? UNREAD_ANCHOR_ID : null,
);

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

// The harness chrome, as utilities. It used to be `harness.css`, and that
// file's whole reason for existing was that it could not touch a `chat-` class
// — so a visual bug in the transcript was never mistakable for a bug in the
// page framing it. Nothing in these strings selects a descendant, let alone a
// `chat-` one, so the separation survives the stylesheet's deletion. The class
// names stay on the elements because a named node is still easier to find in
// devtools than an anonymous one.
//
// The page used to establish `height: 100%` on html, body and #root. The root
// element is the only one this file renders, and the page is the viewport, so
// the chain collapses to one `h-dvh` and Tailwind's preflight already zeroes
// the body margin.
function App() {
  return (
    <div class="harness-root flex h-dvh min-h-0 flex-col bg-bg">
      <header class="harness-bar flex flex-wrap items-center gap-3 bg-bg-sidebar px-4 py-2 text-weak text-sm shadow-[0_1px_0_0_var(--panel-edge)]">
        <span class="harness-title text-text font-[var(--font-weight-bold)]">Chat slice</span>
        <span class="harness-state font-mono text-accent" data-component="harness-state">
          {unknownFlag() ? `Unknown state: ${slug()}` : slug()}
        </span>
        <span class="harness-spacer flex-1" />
        <span class="harness-hint font-mono text-xs text-faint">
          States: {SLUGS.length} · ?state=&lt;slug&gt;
        </span>
      </header>

      {/* The slice under test, given the remaining height and a width to be
          judged at. Its scroller owns its own scrolling, so this must not clip. */}
      <div class="harness-stage flex min-h-0 flex-1">
        <MessageList
          messages={messages()}
          botById={(id: string | undefined) => (id === undefined ? undefined : botById.get(id))}
          replyParent={(id: string | undefined) => (id === undefined ? undefined : byId().get(id))}
          firstUnreadMessageId={firstUnreadMessageId()}
          onJumpToMessage={() => {}}
          onReplyTarget={setReplyTargetId}
          scrollRef={() => {}}
          onStateChange={setThreadState}
          waitingNames={typingNames()}
          groupChat={params.get("group") === "1"}
          onReact={(id, emoji) => {
            const message = byId().get(id);
            if (message) toggleReaction(message, emoji);
          }}
        />
      </div>
    </div>
  );
}

render(() => <App />, root);

// ---------------------------------------------------------------------------
// Probes
//
// Everything below reads the DOM or the computed style. Nothing reads a signal
// this file owns, because a probe that reported `slug()` would confirm only
// that the URL was parsed.
// ---------------------------------------------------------------------------

// A function declaration, not `<T>(x) => ...`: in a .tsx file a leading `<T>`
// parses as the start of a JSX element, not a type parameter.
function q<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}
const qa = (selector: string): Element[] => [...document.querySelectorAll(selector)];
const text = (selector: string): string | null =>
  q(selector)?.textContent?.trim() ?? null;

/** The tokens the transcript's geometry is made of, read off the live document. */
function readTokens(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    "--user-bubble": read("--user-bubble"),
    "--assistant-bubble": read("--assistant-bubble"),
    "--font-base": read("--font-base"),
    "--radius-bubble": read("--radius-bubble"),
  };
}

export interface ChatProbe {
  /** The state slug currently rendered. */
  state: string;
  /** Virtual rows in the DOM. Virtualised, so this is what is on screen. */
  rows: number;
  /** Message bubbles in the DOM, which is rows minus dividers. */
  bubbles: number;
  /** The date chip's label, or null when no chip is showing. */
  dateChip: string | null;
  /** Every divider label, so a multi-day state is checkable in one read. */
  dayLabels: string[];
  /** Whether the unread rule is present. */
  unreadRule: boolean;
  /** Rows that open a run, i.e. `data-run="start"`. */
  runs: number;
  /** Whether the typing row is present. */
  typing: boolean;
  /** The overlay the harness last asked to open. */
  overlay: "menu" | "picker" | null;
  /** The message the reply gesture is currently aimed at. */
  replyTarget: string | null;
  /** Picture tiles in the DOM, across every message. */
  images: number;
  /** File rows in the DOM, across every message. */
  files: number;
  /** Whether the image dialog is open. */
  viewer: boolean;
  /** Resolved design tokens. */
  tokens: Record<string, string>;
}

function probe(): ChatProbe {
  // A run starts where the row says so. Counting `data-run="start"` is the only
  // way to see grouping through the virtualiser: a run that got split still
  // renders the same number of bubbles.
  const bubbles = qa("[data-message-id]");
  return {
    state: slug(),
    rows: qa("[data-component='chat-vrow']").length,
    bubbles: bubbles.length,
    // The chip is a button; its label is its own text, so read the button
    // rather than reaching for a divider label that is not inside it.
    dateChip: text("[data-component='chat-date-chip'] .chat-chip"),
    // The day divider's label is `[data-component='chat-day-label']`, not a
    // `chat-divider__label` class: this read used to target a class the
    // transcript never renders, so `dayLabels` reported an empty array for
    // every state and a recipe keyed on it could not fail.
    dayLabels: qa("[data-component='chat-day-label']").map((node) => node.textContent?.trim() ?? ""),
    unreadRule: qa("[data-component='chat-unread-rule']").length > 0,
    runs: bubbles.filter((node) => node.getAttribute("data-run") === "start").length,
    typing: qa("[data-component='chat-typing-row']").length > 0,
    overlay: openOverlay(),
    replyTarget: replyTargetId(),
    images: qa("[data-component='chat-attachment-image']").length,
    files: qa("[data-component='chat-attachment-file']").length,
    viewer: q("[data-component='image-dialog']") !== null,
    tokens: readTokens(),
  };
}

/** The row root for a message id, or null when it is scrolled out. */
function rowFor(messageId: string): HTMLElement | null {
  return q<HTMLElement>(`[data-component="chat-row"][data-message-id="${CSS.escape(messageId)}"]`);
}

/**
 * Open the context menu on a message.
 *
 * A dispatched `contextmenu`, not a call into the interaction layer. This is the
 * same event a right-click produces, so it exercises the row's real listener
 * rather than a setter the harness happens to own — a probe that flipped a
 * private signal would prove nothing about the wiring. The return value reports
 * whether a portalled menu actually appeared, so "no menu exists yet" reads as
 * false instead of a pass.
 */
function openMenu(messageId: string): boolean {
  const row = rowFor(messageId);
  if (!row) return false;
  const rect = row.getBoundingClientRect();
  row.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + rect.width / 2),
      clientY: Math.round(rect.top + rect.height / 2),
    }),
  );
  const opened = qa("[role='menu'], [data-component*='menu']").length > 0;
  setOpenOverlay(opened ? "menu" : null);
  return opened;
}

/**
 * Poll a predicate across frames until it holds, or the budget is spent.
 *
 * The picker cannot be checked synchronously: it is a lazily imported
 * component that then loads its own database, so the panel appears a beat after
 * the button is pressed. A probe that read the DOM on the same tick would report
 * a working picker as missing, which is worse than no probe at all.
 */
async function waitFor(predicate: () => boolean, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    const { promise, resolve } = Promise.withResolvers<void>();
    requestAnimationFrame(() => resolve());
    await promise;
  }
  return predicate();
}

/**
 * Open the emoji picker on a message.
 *
 * Same principle as `openMenu`: the events a reader produces, on the controls
 * they actually press. The route is a right-click and then the menu's "more
 * emoji" button, because the menu is the one route that touch has too. It is
 * async for the reason `waitFor` gives.
 */
async function openPicker(messageId: string): Promise<boolean> {
  const row = rowFor(messageId);
  if (!row) return false;
  if (!openMenu(messageId)) return false;
  const more = q<HTMLElement>(".chat-menu__more");
  if (more === null) return false;
  more.click();
  const opened = await waitFor(() => q("[data-component='emoji-picker']") !== null, 5000);
  setOpenOverlay(opened ? "picker" : null);
  return opened;
}

/**
 * Open the image dialog on one picture of a message, with a dispatched click on the tile a reader
 * would press, so the row's own handler is what is tested. The dialog body loads on first open,
 * so this resolves once it is mounted, or false after a second.
 */
async function openMedia(messageId: string, index = 0): Promise<boolean> {
  const tile = rowFor(messageId)?.querySelectorAll<HTMLElement>("[data-component='chat-attachment-image']")[index];
  if (!tile) return false;
  tile.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  for (let i = 0; i < 20 && !q("[data-component='image-dialog']"); i++) await new Promise((r) => setTimeout(r, 50));
  return q("[data-component='image-dialog']") !== null;
}

/** Close the image dialog with Escape, the key a reader would press. Kobalte's dialog owns it. */
function closeMedia(): boolean {
  if (!q("[data-component='image-dialog']")) return false;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  return q("[data-component='image-dialog']") === null;
}

/** The harness's window handle. Named for the page it is on. */
const chat = {
  /** Every addressable state, so a caller can enumerate without importing. */
  states: () => [...SLUGS],

  setState(next: string) {
    const { slug: resolved, known } = resolveSlug(next);
    setSlug(resolved);
    setUnknownFlag(!known);
    setOpenOverlay(null);
    setReplyTargetId(null);
    return resolved;
  },

  setTyping(names: readonly string[]) {
    setTypingNames([...names]);
    return typingNames();
  },

  setReplyTarget(messageId: string | null) {
    setReplyTargetId(messageId);
    return replyTargetId();
  },

  openMenu,
  openPicker,
  openMedia,
  closeMedia,

  /** Read-only view of the current state, for a caller that only asserts. */
  state: slug,
  messages,
  probe,
  threadState,
  /** The person the composer speaks for, so a probe can identify own rows. */
  viewerId: VIEWER_ID,
};

Object.assign(window, { __chat: chat });
