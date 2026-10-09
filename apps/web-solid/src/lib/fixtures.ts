// Static transcript states for the chat harness (`chat/harness.tsx`) and the
// tests. The app reads the sync stores instead, so nothing in the production
// import graph may import this file. The mock room starts from the protocol
// fixtures in `@yuki/protocol/fixtures`.
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

import type { ChatMessage, MessageFile, RosterBot } from "./types";

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

// ---------------------------------------------------------------------------
// ATTACHMENTS
//
// The harness has no server, so a picture is a small SVG card drawn inline: a
// coloured field with its size written on it. Its `type` is the one a stored
// picture has, which is what picks the grid; any <img> draws the card. A file
// row needs no bytes, so its `src` is a placeholder.
// ---------------------------------------------------------------------------

const SIZES = {
  landscape: [1600, 900, "#3b6fd6"],
  wide: [1400, 700, "#2f9e6b"],
  pano: [2100, 1000, "#c2513a"],
  square: [1000, 1000, "#8a4fd0"],
  portrait: [900, 1600, "#d08a2a"],
  tall: [700, 1400, "#2a8fb0"],
  narrow: [180, 800, "#b03a7a"],
  small: [300, 200, "#5a6470"],
} as const;

function picture(shape: keyof typeof SIZES): MessageFile {
  const [width, height, color] = SIZES[shape];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="50%" fill="white" font-family="sans-serif" font-size="${Math.round(Math.min(width, height) / 6)}" text-anchor="middle" dominant-baseline="middle">${width}x${height}</text></svg>`;
  return { name: `${shape}.png`, size: svg.length, type: "image/png", src: `data:image/svg+xml,${encodeURIComponent(svg)}` };
}

function file(name: string, size: number, type: string): MessageFile {
  return { name, size, type, src: "#" };
}

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
    body: "One :root block in kat.css. Two named radius roles, and every other corner is calc() off a single --brm.",
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

  // --- yesterday: pictures, links, and the reply quote paths ----------------
  {
    id: "a-25",
    threadId: "ada",
    sender: "user",
    body: "A 16:9 card. In the grid it is cropped to a 4:3 tile, and the dialog shows it whole.",
    sentAt: YESTERDAY + 14 * 60 * MINUTE,
    files: [
      picture("landscape"),
    ],
  },
  {
    id: "a-26",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "Same card at 2:1. An agent never attaches files now, but an old message that has one draws the same tile.",
    sentAt: YESTERDAY + 14 * 60 * MINUTE + 2 * MINUTE,
    replyToId: "a-25",
    files: [
      picture("wide"),
    ],
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
    body: "Right. Text quotes clamp to a line, picture quotes show a square thumbnail. Same slot, two shapes.",
    sentAt: YESTERDAY + 14 * 60 * MINUTE + 5 * MINUTE,
    reactions: [{ emoji: "✅", count: 1, viewerReacted: true }],
  },

  // --- links in the body: the text draws them, nothing else --------------
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
  },
  {
    id: "a-30c",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "A link is part of the text: https://example.com/people/anu",
    sentAt: YESTERDAY + 15 * MINUTE + 4 * MINUTE,
  },
  {
    id: "a-30b",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "And another: https://solidjs.com/ecosystem",
    sentAt: YESTERDAY + 15 * MINUTE + 3 * MINUTE,
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

  // --- yesterday: the picture grid, file rows, and the rich-text body ------
  //
  // Its own block, and its own `m-` id prefix, so a reader can scroll straight
  // to one case. The counts climb 2, 3, 4, 5: an odd count leaves a lone tile on
  // the last row, which is the case to check.
  {
    id: "m-01",
    threadId: "ada",
    sender: "user",
    body: "Two pictures, a 16:9 beside a 9:16. Both crop to the same 4:3 tile.",
    sentAt: YESTERDAY + 16 * 60 * MINUTE,
    files: [
      picture("landscape"),
      picture("portrait"),
    ],
  },
  {
    id: "m-02",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "Three leaves a lone tile on the second row.",
    sentAt: YESTERDAY + 16 * 60 * MINUTE + 2 * MINUTE,
    files: [
      picture("wide"),
      picture("square"),
      picture("tall"),
    ],
  },
  {
    id: "m-03",
    threadId: "ada",
    sender: "user",
    body: "Four is a plain 2x2.",
    sentAt: YESTERDAY + 16 * 60 * MINUTE + 4 * MINUTE,
    files: [
      picture("landscape"),
      picture("square"),
      picture("tall"),
      picture("small"),
    ],
  },
  {
    id: "m-04",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "Five: two full rows and one tile.",
    sentAt: YESTERDAY + 16 * 60 * MINUTE + 6 * MINUTE,
    files: [
      picture("wide"),
      picture("square"),
      picture("landscape"),
      picture("tall"),
      picture("narrow"),
    ],
  },
  {
    id: "m-05",
    threadId: "ada",
    sender: "user",
    body: "A pano beside a square and a portrait. The tile crops every shape the same way.",
    sentAt: YESTERDAY + 16 * 60 * MINUTE + 8 * MINUTE,
    files: [
      picture("pano"),
      picture("square"),
      picture("portrait"),
    ],
  },
  {
    id: "m-06",
    threadId: "ada",
    sender: "user",
    body: "",
    sentAt: YESTERDAY + 16 * 60 * MINUTE + 10 * MINUTE,
    files: [
      picture("square"),
    ],
  },
  {
    id: "m-07",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "And one picture with a line of text under it.",
    sentAt: YESTERDAY + 16 * 60 * MINUTE + 12 * MINUTE,
    files: [
      picture("portrait"),
    ],
  },
  {
    id: "m-08",
    threadId: "ada",
    sender: "user",
    body: "",
    sentAt: YESTERDAY + 16 * 60 * MINUTE + 14 * MINUTE,
    files: [
      file("clip-landscape.mp4", 1_204_224, "video/mp4"),
    ],
  },
  {
    id: "m-09",
    threadId: "ada",
    sender: "user",
    body: "A clip is a file row, with a line of text under it.",
    sentAt: YESTERDAY + 16 * 60 * MINUTE + 16 * MINUTE,
    files: [
      file("clip-landscape.mp4", 1_204_224, "video/mp4"),
    ],
  },
  {
    id: "m-10",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "An old agent message with a clip draws the same row.",
    sentAt: YESTERDAY + 16 * 60 * MINUTE + 18 * MINUTE,
    files: [
      file("clip-portrait.mp4", 1_204_224, "video/mp4"),
    ],
  },
  {
    id: "m-11",
    threadId: "ada",
    sender: "user",
    body: "A picture and a link in one message: https://example.com/design/geometry",
    sentAt: YESTERDAY + 16 * 60 * MINUTE + 20 * MINUTE,
    files: [
      picture("landscape"),
    ],
  },
  {
    id: "m-12",
    threadId: "ada",
    sender: "user",
    body: "Every shape the body parser has to tell apart, in one line: a bare link is https://example.com/geometry, a www. run is www.example.com, a trailing full stop is https://example.com/trailing. and foo.zzz is not a url so it has to stay plain text. Mail goes to ada@example.com, ping @ada, file it under #geometry — and https://аррӏе.com is not what it looks like.",
    sentAt: YESTERDAY + 16 * 60 * MINUTE + 22 * MINUTE,
  },
  {
    id: "d-01",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "Here is the Q3 report, final numbers included.",
    sentAt: YESTERDAY + 17 * 60 * MINUTE,
    files: [file("Q3-report.pdf", 1_887_437, "application/pdf")],
  },
  {
    id: "d-02",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "",
    sentAt: YESTERDAY + 17 * 60 * MINUTE + 10 * MINUTE,
    files: [
      file("design-spec.pdf", 482_304, "application/pdf"),
      file("assets.zip", 12_582_912, "application/zip"),
      file("metrics.csv", 3_276, "text/csv"),
    ],
  },
  {
    id: "d-03",
    threadId: "ada",
    sender: "user",
    body: "",
    sentAt: YESTERDAY + 17 * 60 * MINUTE + 12 * MINUTE,
    files: [
      file("notes.docx", 45_056, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ],
  },
  {
    id: "u-01",
    threadId: "ada",
    sender: "user",
    body: "Three shots from the review, in order.",
    sentAt: YESTERDAY + 18 * 60 * MINUTE,
    files: [
      picture("landscape"),
      picture("square"),
      picture("portrait"),
    ],
  },
  {
    id: "u-02",
    threadId: "ada",
    sender: "user",
    body: "Two more that go with that picture.",
    sentAt: YESTERDAY + 18 * 60 * MINUTE + 10 * MINUTE,
    replyToId: "a-25",
    files: [picture("square"), picture("wide")],
  },
  {
    id: "u-03",
    threadId: "ada",
    sender: "user",
    body: "",
    sentAt: YESTERDAY + 18 * 60 * MINUTE + 20 * MINUTE,
    files: [picture("portrait")],
  },
  {
    id: "l-01",
    threadId: "ada",
    sender: "user",
    body: "https://www.youtube.com/watch?v=yveEiS0rlu4",
    sentAt: YESTERDAY + 19 * 60 * MINUTE,
  },
  {
    id: "l-02",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "https://t.me/heisanu",
    sentAt: YESTERDAY + 19 * 60 * MINUTE + 10 * MINUTE,
  },
  {
    id: "l-03",
    threadId: "ada",
    sender: "user",
    body: "https://app.devin.ai",
    sentAt: YESTERDAY + 19 * 60 * MINUTE + 20 * MINUTE,
  },
  {
    id: "l-04",
    threadId: "ada",
    sender: "user",
    body: "https://example.com/no-preview-here",
    sentAt: YESTERDAY + 19 * 60 * MINUTE + 30 * MINUTE,
  },
  {
    id: "run-01",
    threadId: "ada",
    sender: "user",
    body: "First of three from me.",
    sentAt: YESTERDAY + 20 * 60 * MINUTE,
  },
  {
    id: "run-02",
    threadId: "ada",
    sender: "user",
    body: "Second one, a little longer so the corners of the middle bubble have something to join.",
    sentAt: YESTERDAY + 20 * 60 * MINUTE + 1 * MINUTE,
  },
  {
    id: "run-03",
    threadId: "ada",
    sender: "user",
    body: "Third.",
    sentAt: YESTERDAY + 20 * 60 * MINUTE + 2 * MINUTE,
  },
  {
    id: "run-04",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "Reply run, first.",
    sentAt: YESTERDAY + 20 * 60 * MINUTE + 3 * MINUTE,
  },
  {
    id: "run-05",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "Reply run, second.",
    sentAt: YESTERDAY + 20 * 60 * MINUTE + 4 * MINUTE,
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

function readMore(): readonly ChatMessage[] {
  const sentence = "The transcript keeps one scroll owner and every row is remeasured after it changes. ";
  const body = sentence.repeat(36).slice(0, 3000);
  const at = NOW - 20 * MINUTE;
  const row = (id: string, text: string, n: number, sender: "user" | "bot"): ChatMessage => ({
    id,
    threadId: "ada",
    sender,
    ...(sender === "bot" ? { botId: BOTS[0].id } : {}),
    body: text,
    sentAt: at + n * MINUTE,
  });
  return [
    row("rm-1", "before the long one", 0, "bot"),
    row("rm-2", body, 1, "bot"),
    row("rm-3", "after one", 2, "user"),
    row("rm-4", "after two", 3, "user"),
  ];
}

/** Two messages ten minutes apart, then one two hours later: one pause divider. */
function pauseGap(): readonly ChatMessage[] {
  const row = (id: string, n: number, sender: "user" | "bot"): ChatMessage => ({
    id,
    threadId: "ada",
    sender,
    ...(sender === "bot" ? { botId: BOTS[0].id } : {}),
    body: id,
    sentAt: NOW - n * MINUTE,
  });
  return [row("pg-1", 150, "bot"), row("pg-2", 140, "user"), row("pg-3", 20, "bot")];
}

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
  // A 3,000 character body between short rows: clamped, then expanded in place.
  "read-more": readMore(),
  // A pause over an hour inside one day gets a divider; ten minutes does not.
  "pause-gap": pauseGap(),
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

  // Links are text: the body draws them, and nothing else.
  link: slice("a-29", "a-30", "a-30c", "a-30b"),

  // A reply whose parent is text, and a reply whose parent is an image, so the
  // quote renders both the clamped text line and the thumbnail.
  "reply-text": slice("a-35", "a-36"),
  "reply-image": slice("a-25", "a-26", "a-27"),

  // The picture grid, one count per state: a lone picture spans both
  // columns, and an odd count leaves one tile on the last row.
  "grid-2": slice("m-01"),
  "grid-3": slice("m-02"),
  "grid-4": slice("m-03"),
  "grid-5": slice("m-04"),
  "grid-shapes": slice("m-05"),

  // A single picture with no body, then one with a line of text under it.
  "picture-only": slice("m-06"),
  "picture-caption": slice("m-07"),

  // A clip is a file row like any other file.
  video: slice("m-08", "m-09", "m-10"),

  // A picture and a link in one message.
  "picture-link": slice("m-11"),

  // Every run the body parser has to tell apart on one line: a bare scheme, a
  // `www.` run, a trailing full stop, a non-TLD that must stay text, an email,
  // a mention, a hashtag, and a homograph host that has to be flagged.
  "rich-text": slice("m-12"),

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

  "file-single": slice("d-01"),
  "file-group": slice("d-02", "d-03"),
  "user-grid-3": slice("u-01"),
  "user-grid-2-reply": slice("a-25", "u-02"),
  "user-picture": slice("u-03"),
  "link-only": slice("l-01", "l-02", "l-03", "l-04"),
  "grouped-own": slice("run-01", "run-02", "run-03", "run-04", "run-05"),
};

/** The message `firstUnreadIndex` anchors on in the `unread` state. */
export const UNREAD_ANCHOR_ID = "a-37";

