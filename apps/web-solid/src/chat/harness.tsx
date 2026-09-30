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
//   2. The slice's own stylesheet AND the app's token chain are imported HERE
//      rather than relied on from main.tsx. The composed app pulls both in
//      through its own entry; a harness mounted on its own page would otherwise
//      render unstyled, and every probe reading a colour or a font size would
//      report a missing stylesheet as a design bug. The token chain in
//      particular is not optional: `chat.css` resolves every value through it,
//      so without it the page is structurally correct and completely colourless.

import { createMemo, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { BOTS, FIXTURE_STATES, NOW, UNREAD_ANCHOR_ID, VIEWER_ID } from "../lib/fixtures";
import type { ChatMessage, RosterBot } from "../lib/types";
import { MessageList, type VirtualThreadState } from "./MessageList";
import "./chat.css";
import "./harness.css";
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
/** The message the reply gesture is aimed at; null means "not swiping". */
const [replyTargetId, setReplyTargetId] = createSignal<string | null>(null);
/** Set by the menu/picker openers so a probe can tell a real open from a no-op. */
const [openOverlay, setOpenOverlay] = createSignal<"menu" | "picker" | null>(null);
/** The last scroll state the shell reported, for scroll-anchoring checks. */
const [threadState, setThreadState] = createSignal<VirtualThreadState | null>(null);

const messages = createMemo<readonly ChatMessage[]>(
  () => FIXTURE_STATES[slug()] ?? FIXTURE_STATES[DEFAULT_STATE],
);

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

function App() {
  return (
    <div class="harness-root">
      <header class="harness-bar">
        <span class="harness-title">chat slice</span>
        <span class="harness-state" data-component="harness-state">
          {unknownFlag() ? `unknown state: ${slug()}` : slug()}
        </span>
        <span class="harness-spacer" />
        <span class="harness-hint">
          states: {SLUGS.length} · ?state=&lt;slug&gt;
        </span>
      </header>

      <div class="harness-stage">
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
    dayLabels: qa(".chat-divider__label").map((node) => node.textContent?.trim() ?? ""),
    unreadRule: qa("[data-component='chat-unread-rule']").length > 0,
    runs: bubbles.filter((node) => node.getAttribute("data-run") === "start").length,
    typing: qa(".chat-typing-row").length > 0,
    overlay: openOverlay(),
    replyTarget: replyTargetId(),
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
 * Open the emoji picker on a message.
 *
 * Same principle as `openMenu`: dispatch the events a tap produces on the
 * row's own add-reaction control, falling back to the row when no control is
 * rendered. Returns whether a picker actually appeared, so an unbuilt picker
 * reports false rather than passing silently.
 */
function openPicker(messageId: string): boolean {
  const row = rowFor(messageId);
  if (!row) return false;
  const target =
    row.querySelector<HTMLElement>("[data-component='chat-add-reaction']") ??
    row.querySelector<HTMLElement>(".chat-add-reaction") ??
    row;
  for (const type of ["pointerdown", "pointerup", "click"] as const) {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  }
  const opened = qa("[data-component*='picker'], [data-component*='emoji']").length > 0;
  setOpenOverlay(opened ? "picker" : null);
  return opened;
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

  /** Read-only view of the current state, for a caller that only asserts. */
  state: slug,
  messages,
  probe,
  threadState,
  /** The person the composer speaks for, so a probe can identify own rows. */
  viewerId: VIEWER_ID,
};

Object.assign(window, { __chat: chat });
