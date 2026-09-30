// Static data. There is no backend, no database, and no networking: every state
// the UI can reach has to be reachable from here, which is the point of
// building the interface first.
//
// Two layers, and the split matters:
//
//   MESSAGES       one long multi-day transcript per thread, the thing the
//                  composed app actually renders. A linear transcript has
//                  states a two-message fixture cannot produce: a day
//                  boundary, a run that wraps past the grouping window, a
//                  reply that must resolve its parent, a reaction the viewer
//                  has and has not given, and enough rows to scroll.
//
//   FIXTURE_STATES named slices of that same transcript, so a single state can
//                  be opened in isolation at harness.html?state=<slug>. The
//                  slices are views over the same objects, not copies, so a
//                  fixture can never drift from the transcript it came from.
//
// Every timestamp is relative to the exported NOW, so the day labels ("three
// days ago", "yesterday", "today") are stable no matter when this is read.

import type { ChatMessage, RosterBot, RosterGroup } from "./types";

export const VIEWER_ID = "viewer";

/**
 * The clock the whole fixture set is anchored to, and the single source of
 * every timestamp below.
 *
 * Anchored to the real clock on purpose, not frozen to a literal. The shell
 * labels a day with `dayChipLabel(dayStart, Date.now())`, so a fixture pinned to
 * a fixed date in the past makes "today" and "yesterday" permanently
 * unreachable — the chips would read "monday" and "sunday" forever, and the
 * two states that exist to prove those labels would prove nothing. Reading the
 * clock once at module load keeps every timestamp in this file consistent with
 * itself and with the shell that renders it.
 */
export const NOW = Date.now();

const DAY = 86_400_000;
const MINUTE = 60_000;

/** Local midnight of the day `sentAt` falls in. Mirrors the shell's own. */
function localDayStart(sentAt: number): number {
  const d = new Date(sentAt);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

const TODAY_START = localDayStart(NOW);

function daysAgoStart(days: number): number {
  const d = new Date(TODAY_START);
  d.setDate(d.getDate() - days);
  return d.getTime();
}

// Midnight-relative, not `NOW - n * 24h`: subtracting fixed spans from an
// instant drifts a day across a DST boundary, and a message that lands on the
// wrong calendar day changes which chip it sits under.
const THREE_DAYS_AGO = daysAgoStart(3);
const TWO_DAYS_AGO = daysAgoStart(2);
const YESTERDAY = daysAgoStart(1);

/**
 * A moment `offset` before NOW, clamped to stay inside today.
 *
 * Today's messages are written as "N minutes ago", which is only inside today
 * when the clock reads later than N minutes past midnight. Clamping keeps a
 * transcript opened at 00:05 from filing this morning's rows under yesterday.
 * Offsets shrink together so the ordering and the run gaps survive the clamp.
 */
const TODAY_MAX_OFFSET = 40 * MINUTE;
const ELAPSED_TODAY = Math.max(NOW - TODAY_START, MINUTE);
const TODAY_SCALE = Math.min(1, (ELAPSED_TODAY - 1) / TODAY_MAX_OFFSET);
const todayAgo = (offset: number): number => NOW - offset * TODAY_SCALE;

export const BOTS: readonly RosterBot[] = [
  {
    id: "ada",
    name: "Ada",
    color: "#7c9ef0",
    preview: "The radius ladder is one calc() off a single value.",
    updatedAt: NOW,
    presence: "idle",
    unread: 0,
    pinned: true,
    persona: "Systems engineer. Concise, allergic to hand-waving.",
  },
  {
    id: "grace",
    name: "Grace",
    color: "#e07c9f",
    preview: "Sidebar is mine. I will own sidebar.css outright.",
    updatedAt: NOW - 2 * MINUTE,
    presence: "working",
    unread: 4,
    pinned: true,
    persona: "Design systems. Will argue about radius for an hour.",
  },
  {
    id: "alan",
    name: "Alan",
    color: "#7fc99a",
    preview: "Send is optimistic, no round trip in v1.",
    updatedAt: NOW - 4 * MINUTE,
    presence: "typing",
    unread: 1,
    pinned: false,
  },
  {
    id: "katherine",
    name: "Katherine",
    color: "#d9a05b",
    preview: "Standup notes are in the thread above.",
    updatedAt: NOW - 2 * DAY,
    presence: "sleeping",
    unread: 0,
    pinned: false,
  },
];

export const GROUPS: readonly RosterGroup[] = [
  {
    id: "launch",
    name: "Launch",
    memberIds: ["ada", "grace", "alan"],
    updatedAt: NOW,
  },
];


/**
 * Inline SVG rather than a binary asset. The harness must render an image row
 * and a quote thumbnail with no fetch, no asset pipeline, and no chance of a
 * broken image standing in for a real layout bug. Percent-encoded rather than
 * base64 so the markup stays readable in devtools.
 */
function svgImage(
  label: string,
  from: string,
  to: string,
  width = 480,
  height = 270,
): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
    `</linearGradient></defs>` +
    `<rect width="${width}" height="${height}" fill="url(#g)"/>` +
    `<circle cx="${width * 0.76}" cy="${height * 0.3}" r="${height * 0.22}" fill="oklch(100% 0 none / 0.16)"/>` +
    `<rect x="${width * 0.08}" y="${height * 0.62}" width="${width * 0.44}" height="${height * 0.06}" rx="${height * 0.03}" fill="oklch(100% 0 none / 0.5)"/>` +
    `<rect x="${width * 0.08}" y="${height * 0.76}" width="${width * 0.3}" height="${height * 0.06}" rx="${height * 0.03}" fill="oklch(100% 0 none / 0.28)"/>` +
    `<text x="${width * 0.08}" y="${height * 0.34}" fill="oklch(100% 0 none / 0.92)" font-family="InterVariable, system-ui, sans-serif" font-size="${height * 0.13}" font-weight="600">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const MOUNTAIN_SVG = svgImage("oklch", "#4c3a52", "#2a1f2e", 640, 360);
const DIAGRAM_SVG = svgImage("tokens", "#2f4a52", "#1d2b30", 560, 320);

export const MESSAGES: readonly ChatMessage[] = [
  // --- three days ago: the token bridge thread, a grouped run ---------------
  {
    id: "a-01",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "Picking up the token bridge thread from before. The short version: everything resolves through one :root block and the Tailwind v4 @theme inline layer reads from it.",
    sentAt: THREE_DAYS_AGO + 9 * 60 * MINUTE,
  },
  {
    id: "a-02",
    threadId: "ada",
    sender: "user",
    body: "Where did the radius ladder land?",
    sentAt: THREE_DAYS_AGO + 9 * 60 * MINUTE + 2 * MINUTE,
    reactions: [{ emoji: "👀", count: 2, viewerReacted: true }],
  },
  {
    id: "a-03",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "One :root block in kiko.css. The whole scale is calc() off a single --radius.",
    sentAt: THREE_DAYS_AGO + 9 * 60 * MINUTE + 3 * MINUTE,
  },
  {
    id: "a-04",
    threadId: "ada",
    sender: "user",
    body: "And the duplicate declaration?",
    sentAt: THREE_DAYS_AGO + 9 * 60 * MINUTE + 4 * MINUTE,
  },
  {
    id: "a-05",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "Gone. Tailwind v4 already registers the names, so the @theme block was redundant.",
    sentAt: THREE_DAYS_AGO + 9 * 60 * MINUTE + 5 * MINUTE,
    reactions: [{ emoji: "✅", count: 3, viewerReacted: false }],
  },

  // The grouped run: three consecutive agent messages inside the window. A
  // transcript that only ever alternates one-for-one never exercises the
  // collapse that makes the run worth building.
  {
    id: "a-06",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "Three follow-ups before you ask. One: the ladder is calc() off --radius, so every rung moves together. Two: the rungs are unlayered on purpose, so they beat the flat radius in theme.css regardless of import order. Three: changing --radius moves the entire product, which is the point and also the risk.",
    sentAt: THREE_DAYS_AGO + 9 * 60 * MINUTE + 6 * MINUTE,
  },
  {
    id: "a-07",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "If a component wants to opt out of the ladder, give it an explicit radius rather than reaching for the flat token. Mixing the two is how you get a pill next to a card that disagree.",
    sentAt: THREE_DAYS_AGO + 9 * 60 * MINUTE + 7 * MINUTE,
  },
  {
    id: "a-08",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "That is three in a row on purpose.",
    sentAt: THREE_DAYS_AGO + 9 * 60 * MINUTE + 8 * MINUTE,
    reactions: [{ emoji: "🫡", count: 1, viewerReacted: true }],
  },

  // --- run-gap: past the 300s window, same author, fresh run ---------------
  {
    id: "a-09",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "Six minutes later, so the grouping window has closed and this starts a fresh run even though nothing about the sender changed.",
    sentAt: THREE_DAYS_AGO + 9 * 60 * MINUTE + 15 * MINUTE,
  },
  {
    id: "a-10",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "Which is the point. The window is what stops a run from growing forever.",
    sentAt: THREE_DAYS_AGO + 9 * 60 * MINUTE + 16 * MINUTE,
  },

  // --- run-break-reply: the viewer replying always breaks a run -------------
  {
    id: "a-11",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "The spacing scale is one primitive: --spacing at 0.25rem, which is Tailwind's multiplier. So p-2 is 0.5rem and gap-6 is 1.5rem.",
    sentAt: THREE_DAYS_AGO + 9 * 60 * MINUTE + 12 * MINUTE,
  },
  {
    id: "a-12",
    threadId: "ada",
    sender: "user",
    body: "One second — every v2 component hardcodes px, so there is no density to inherit anyway.",
    sentAt: THREE_DAYS_AGO + 9 * 60 * MINUTE + 13 * MINUTE,
  },
  {
    id: "a-13",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "Then the transcript owns its own density, and nobody else is going to give it one.",
    sentAt: THREE_DAYS_AGO + 9 * 60 * MINUTE + 14 * MINUTE,
    reactions: [{ emoji: "💯", count: 1, viewerReacted: true }],
  },

  // --- two days ago: the grouping constant, then reactions ------------------
  {
    id: "a-14",
    threadId: "ada",
    sender: "user",
    body: "Fine. But if the run gap is a magic number in two places I will find it.",
    sentAt: TWO_DAYS_AGO + 11 * 60 * MINUTE,
  },
  {
    id: "a-15",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "One constant, one module, one test. Grouping is pure so it can be tested without a DOM.",
    sentAt: TWO_DAYS_AGO + 11 * 60 * MINUTE + MINUTE,
  },
  {
    id: "a-16",
    threadId: "ada",
    sender: "user",
    body: "How long is the window before a new run starts?",
    sentAt: TWO_DAYS_AGO + 12 * 60 * MINUTE,
  },
  {
    id: "a-17",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "Five minutes. Inside it, same author collapses into the run above. Outside it, new run.",
    sentAt: TWO_DAYS_AGO + 12 * 60 * MINUTE + MINUTE,
    reactions: [{ emoji: "👍", count: 4, viewerReacted: false }],
  },

  // --- reactions: one the viewer has already given, so the chip reads pressed -
  {
    id: "a-18",
    threadId: "ada",
    sender: "user",
    body: "What is the last call on reactions?",
    sentAt: TWO_DAYS_AGO + 12 * 60 * MINUTE + 3 * MINUTE,
  },
  {
    id: "a-19",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "A chip row under the body. Clicking your own removes it. No picker modal, no long-press requirement, no burst animation.",
    sentAt: TWO_DAYS_AGO + 12 * 60 * MINUTE + 4 * MINUTE,
    reactions: [
      { emoji: "❤️", count: 1, viewerReacted: true },
      { emoji: "✅", count: 2, viewerReacted: false },
    ],
  },
  {
    id: "a-20",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "They attach to the message. They do not replace it and they do not open anything.",
    sentAt: TWO_DAYS_AGO + 12 * 60 * MINUTE + 5 * MINUTE,
  },

  // --- edited: the marker without a rewritten body --------------------------
  {
    id: "a-21",
    threadId: "ada",
    sender: "user",
    body: "Do we virtualise from day one, or only when it hurts?",
    sentAt: TWO_DAYS_AGO + 12 * 60 * MINUTE + 7 * MINUTE,
  },
  {
    id: "a-22",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "From day one. Retrofitting measurement into a live scroller is far worse than starting with it.",
    sentAt: TWO_DAYS_AGO + 12 * 60 * MINUTE + 8 * MINUTE,
    edited: true,
  },

  // --- pinned: a long body that wraps, so the pin marker and a tall row meet
  {
    id: "a-23",
    threadId: "ada",
    sender: "user",
    body: "Pinning the decision so we stop relitigating it: the transcript virtualises from day one, the scroll container owns anchoring, and the grouping window stays a single exported constant with a test beside it. Three things, one decision, one paragraph, so the next person reading this does not have to reconstruct the argument from the messages above.",
    sentAt: TWO_DAYS_AGO + 12 * 60 * MINUTE + 10 * MINUTE,
    pinned: true,
  },
  {
    id: "a-24",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "Pinned. That is the whole decision.",
    sentAt: TWO_DAYS_AGO + 12 * 60 * MINUTE + 11 * MINUTE,
  },

  // --- yesterday: images, links, and the reply quote paths ------------------
  {
    id: "a-25",
    threadId: "ada",
    sender: "user",
    body: "Here is the ladder as it renders. The sm step is visibly tighter than the rest.",
    sentAt: YESTERDAY + 14 * 60 * MINUTE,
    image: {
      src: MOUNTAIN_SVG,
      alt: "Radius ladder screenshot: eight steps, the smallest noticeably tighter than the rest",
      width: 640,
      height: 360,
    },
  },
  {
    id: "a-26",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "That is the calc() I flagged. One unit short on the sm step, and everything after it inherits the error.",
    sentAt: YESTERDAY + 14 * 60 * MINUTE + 2 * MINUTE,
    replyToId: "a-25",
    image: {
      src: DIAGRAM_SVG,
      alt: "Diagram of the radius ladder with the sm step marked one unit short",
      width: 560,
      height: 320,
    },
  },
  {
    id: "a-27",
    threadId: "ada",
    sender: "user",
    body: "A reply to an image: the quote above this has to carry a thumbnail, not just the first line of text.",
    sentAt: YESTERDAY + 14 * 60 * MINUTE + 4 * MINUTE,
    replyToId: "a-26",
  },
  {
    id: "a-28",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "Right. Text quotes clamp to a line, image quotes clamp to a square. Same slot, two shapes.",
    sentAt: YESTERDAY + 14 * 60 * MINUTE + 5 * MINUTE,
    reactions: [{ emoji: "✅", count: 1, viewerReacted: true }],
  },

  // --- link in the body, and a link preview card ----------------------------
  {
    id: "a-29",
    threadId: "ada",
    sender: "user",
    body: "The whole write-up is at https://example.com/design/radius-ladder if you want the long version.",
    sentAt: YESTERDAY + 15 * 60 * MINUTE,
  },
  {
    id: "a-30",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "Read it. One correction, and it is the same sm step.",
    sentAt: YESTERDAY + 15 * 60 * MINUTE + 2 * MINUTE,
    linkPreview: {
      url: "https://example.com/design/radius-ladder",
      title: "The radius ladder, and why one calc() is enough",
      description:
        "A single derivation from --radius to every step, with the reason the rungs are unlayered.",
      site: "Design notes",
    },
  },

  // --- jumbo: one emoji, two emoji, and an emoji with prose ---------------
  {
    id: "a-31",
    threadId: "ada",
    sender: "user",
    body: "🎉",
    sentAt: YESTERDAY + 15 * 60 * MINUTE + 4 * MINUTE,
  },
  {
    id: "a-32",
    threadId: "ada",
    sender: "user",
    body: "🎉🚀",
    sentAt: YESTERDAY + 15 * 60 * MINUTE + 5 * MINUTE,
  },
  {
    id: "a-33",
    threadId: "ada",
    sender: "user",
    body: "🎉 the sm step is finally right",
    sentAt: YESTERDAY + 15 * 60 * MINUTE + 6 * MINUTE,
  },
  {
    id: "a-34",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "Three bodies, three classes. The prose one must fall back to text size or it reads as a headline.",
    sentAt: YESTERDAY + 15 * 60 * MINUTE + 7 * MINUTE,
  },

  // --- today: the tail, with the unread anchor in the middle ---------------
  {
    id: "a-35",
    threadId: "ada",
    sender: "user",
    body: "Agreed. Inline replies too, one level, quoted line above the body.",
    sentAt: todayAgo(20 * MINUTE),
  },
  {
    id: "a-36",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "One level. A thread panel is a different product and it is not v1.",
    sentAt: todayAgo(18 * MINUTE),
    replyToId: "a-35",
    reactions: [{ emoji: "👌", count: 2, viewerReacted: false }],
  },
  {
    id: "a-37",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "This is the first unread incoming message, so the rule above it has an anchor that is not the last row.",
    sentAt: todayAgo(12 * MINUTE),
  },
  {
    id: "a-38",
    threadId: "ada",
    sender: "user",
    body: "Understood. And the swipe commits on release?",
    sentAt: todayAgo(10 * MINUTE),
  },
  {
    id: "a-39",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "On release, after the transform clears. Committing mid-drag means the row jumps while the finger is still down.",
    sentAt: todayAgo(9 * MINUTE),
  },
  {
    id: "a-40",
    threadId: "ada",
    sender: "user",
    body: "Ship it.",
    sentAt: todayAgo(4 * MINUTE),
    status: "sending",
  },
  {
    id: "a-41",
    threadId: "ada",
    sender: "user",
    body: "Shipped. One more pass tomorrow for the failing-send state.",
    sentAt: todayAgo(2 * MINUTE),
    status: "sent",
  },

  // --- grace: the sidebar thread, so a second conversation has a body ------
  {
    id: "g-01",
    threadId: "grace",
    sender: "bot",
    botId: "grace",
    body: "Taking the sidebar. I will own sidebar.css outright, and I want the harness to be the only way anyone checks my work.",
    sentAt: TWO_DAYS_AGO + 16 * 60 * MINUTE,
  },
  {
    id: "g-02",
    threadId: "grace",
    sender: "bot",
    botId: "grace",
    body: "That means the harness needs a state per condition, not one flag that turns features on. Same discipline as the fixtures.",
    sentAt: TWO_DAYS_AGO + 16 * 60 * MINUTE + MINUTE,
  },
  {
    id: "g-03",
    threadId: "grace",
    sender: "user",
    body: "Agreed. One slug per state, addressable by URL.",
    sentAt: TWO_DAYS_AGO + 16 * 60 * MINUTE + 2 * MINUTE,
  },
  {
    id: "g-04",
    threadId: "grace",
    sender: "bot",
    botId: "grace",
    body: "And the harness chrome needs its own stylesheet so it cannot be confused with the slice's.",
    sentAt: TWO_DAYS_AGO + 16 * 60 * MINUTE + 3 * MINUTE,
    reactions: [{ emoji: "🎨", count: 1, viewerReacted: true }],
  },

  // --- katherine: a short thread that ends in a sleeping bot --------------
  {
    id: "k-01",
    threadId: "katherine",
    sender: "bot",
    botId: "katherine",
    body: "Standup notes. I went quiet because there was nothing left that needed saying.",
    sentAt: THREE_DAYS_AGO + 8 * 60 * MINUTE,
  },
  {
    id: "k-02",
    threadId: "katherine",
    sender: "user",
    body: "Is sleeping the same as done for the day?",
    sentAt: THREE_DAYS_AGO + 8 * 60 * MINUTE + 3 * MINUTE,
  },
  {
    id: "k-03",
    threadId: "katherine",
    sender: "bot",
    botId: "katherine",
    body: "Done is a claim about the work. Sleeping is a claim about me. Only the second one is something I can know.",
    sentAt: THREE_DAYS_AGO + 8 * 60 * MINUTE + 4 * MINUTE,
    reactions: [{ emoji: "💤", count: 2, viewerReacted: true }],
  },

  // --- launch: a group, so grouping has to key on the author --------------
  {
    id: "n-01",
    threadId: "launch",
    sender: "bot",
    botId: "ada",
    body: "Cut list is down to three: the transcript, the composer dock, and the scroll container.",
    sentAt: todayAgo(30 * MINUTE),
  },
  {
    id: "n-02",
    threadId: "launch",
    sender: "bot",
    botId: "grace",
    body: "Two runs from two different people, minutes apart, and the second one is a different speaker. Grouping keys on the author, not the thread, so a group does not collapse into one voice.",
    sentAt: todayAgo(28 * MINUTE),
  },
  {
    id: "n-03",
    threadId: "launch",
    sender: "bot",
    botId: "grace",
    body: "And a reply never joins a run at all, even from the same person, because it carries its own quoted parent.",
    sentAt: todayAgo(27 * MINUTE),
    replyToId: "n-02",
  },
];

// ---------------------------------------------------------------------------
// FIXTURE_STATES — named slices over the transcript above.
//
// `slice(...)` resolves ids to the live objects in MESSAGES, so a state and the
// transcript it came from can never disagree. Ids that are not found throw at
// module load rather than rendering a half-built state: a missing fixture is a
// typo, and a typo should stop the harness, not silently shrink a state.
// ---------------------------------------------------------------------------

const BY_ID: Record<string, ChatMessage> = Object.fromEntries(
  MESSAGES.map((message) => [message.id, message]),
);

function slice(...ids: readonly string[]): readonly ChatMessage[] {
  return ids.map((id) => {
    const message = BY_ID[id];
    if (!message) throw new Error(`fixtures: no message with id "${id}"`);
    return message;
  });
}

export const FIXTURE_STATES: Readonly<Record<string, readonly ChatMessage[]>> = {
  // Three consecutive agent messages inside the window: one run, not three.
  grouped: slice("a-06", "a-07", "a-08"),
  // Same author either side of a gap longer than the 300s window: two runs.
  "run-gap": slice("a-08", "a-09", "a-10"),

  // Two agent messages, the viewer between them: the reply breaks the run.
  "run-break-reply": slice("a-11", "a-12", "a-13"),

  // Wraps well past four lines, so the row has to be measured not guessed.
  long: slice("a-23"),

  // Three bodies that must land in three different jumbo classes.
  "jumbo-single": slice("a-31"),
  "jumbo-group": slice("a-32"),
  "jumbo-prose": slice("a-33"),

  // A link in the body, and a link that resolves to a card.
  link: slice("a-29"),
  "link-card": slice("a-30"),

  // A reply whose parent is text, and a reply whose parent is an image, so the
  // quote renders both the clamped text line and the thumbnail.
  "reply-text": slice("a-35", "a-36"),
  "reply-image": slice("a-25", "a-26", "a-27"),

  // A cluster: one chip the viewer has given, pressed, beside a counted chip
  // they are not part of. Both visible at once is the whole point.
  reactions: slice("a-19"),

  // The edited marker on a body that was not rewritten.
  edited: slice("a-21", "a-22"),

  // A pinned message that is also the long one, plus the reply that follows it.
  pinned: slice("a-23", "a-24"),

  // Day boundaries. Each slice starts on its own day so the chip is addressable
  // in isolation, which is the whole reason these are separate states.
  "three-days-ago": slice("a-01", "a-02", "a-03", "a-04", "a-05"),
  yesterday: slice("a-25", "a-26", "a-27", "a-28"),
  today: slice("a-35", "a-36", "a-37", "a-38", "a-39", "a-40", "a-41"),

  // The unread anchor with rows above AND below it, so the rule cannot pass by
  // being pinned to the end of the list.
  unread: slice("a-35", "a-36", "a-37", "a-38", "a-39"),
};

/** The message `firstUnreadIndex` anchors on in the `unread` state. */
export const UNREAD_ANCHOR_ID = "a-37";

