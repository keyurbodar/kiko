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

import type { ChatMessage, MediaItem, RosterBot, RosterGroup } from "./types";

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

// ---------------------------------------------------------------------------
// THE MEDIA CATALOGUE
//
// Every picture and clip the transcript can carry lives in `public/media`, and
// each one is an ffmpeg testsrc2 card: six saturated vertical bars (red,
// green, yellow, blue, magenta, cyan), a diagonal streak running out of the
// top-left corner, a stepped grey pixel grid at the lower right, and a frame
// counter burned into the top-left. The bar pattern is the readable part, so
// the alt text says which bars survived the crop rather than saying "image".
//
// The sizes are ffprobe's, not the design's. A `MediaItem` carries the
// INTRINSIC size because the box is reserved from it before the bytes land, and
// an album whose cells resized on load would move the scroll anchor of every
// row below it. Keeping the numbers beside the file they came from means
// regenerating an asset is a one-line edit here rather than a silent layout
// shift in the app.
// ---------------------------------------------------------------------------

interface CardSize {
  width: number;
  height: number;
}

const PHOTOS = {
  "photo-landscape.jpg": { width: 1600, height: 900 },
  "photo-wide.jpg": { width: 1400, height: 700 },
  "photo-pano.jpg": { width: 2100, height: 1000 },
  "photo-square.jpg": { width: 1000, height: 1000 },
  "photo-portrait.jpg": { width: 900, height: 1600 },
  "photo-tall.jpg": { width: 700, height: 1400 },
  "photo-narrow.jpg": { width: 180, height: 800 },
  "photo-small.jpg": { width: 300, height: 200 },
} satisfies Record<string, CardSize>;

/** A clip, with the poster frame shown before it plays and the badge's length. */
const VIDEOS = {
  "video-landscape.mp4": {
    width: 1280,
    height: 720,
    duration: 6,
    poster: "video-landscape-poster.jpg",
  },
  "video-portrait.mp4": {
    width: 720,
    height: 1280,
    duration: 4,
    poster: "video-portrait-poster.jpg",
  },
} satisfies Record<string, CardSize & { duration: number; poster: string }>;

type PhotoFile = keyof typeof PHOTOS;
type VideoFile = keyof typeof VIDEOS;

function photo(file: PhotoFile, alt: string): MediaItem {
  return { kind: "photo", src: `/media/${file}`, ...PHOTOS[file], alt };
}

/**
 * The preview image on a web page card, which is the same generated card at
 * the same intrinsic size but carries no alt: the card's own title and site
 * already name it, and an image inside a link inside a link is decoration to
 * assistive tech rather than content.
 */
function cardImage(file: PhotoFile): { src: string; width: number; height: number } {
  return { src: `/media/${file}`, ...PHOTOS[file] };
}

/**
 * A clip item. The poster is its own file rather than a frame the browser has
 * to seek for, because a video that paints nothing until it has buffered
 * reports a black box where the media should be — and a black box reads as a
 * broken cell, not as a clip that has not started.
 */
function video(file: VideoFile, alt: string): MediaItem {
  const { width, height, duration, poster } = VIDEOS[file];
  return {
    kind: "video",
    src: `/media/${file}`,
    width,
    height,
    duration,
    poster: `/media/${poster}`,
    alt,
  };
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

  // --- yesterday: images, links, and the reply quote paths ------------------
  {
    id: "a-25",
    threadId: "ada",
    sender: "user",
    body: "A 16:9 test card, so the fitted box has to letterbox rather than crop. The grey grid at the bottom right is the thing to check.",
    sentAt: YESTERDAY + 14 * 60 * MINUTE,
    media: [
      photo(
        "photo-landscape.jpg",
        "Test card at 16:9: six colour bars, a diagonal streak from the top left, and a stepped grey grid at the lower right",
      ),
    ],
  },
  {
    id: "a-26",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "Same card at 2:1. Wider than the box, so this is the one that has to crop, and the grid block falls off the bottom edge.",
    sentAt: YESTERDAY + 14 * 60 * MINUTE + 2 * MINUTE,
    replyToId: "a-25",
    media: [
      photo(
        "photo-wide.jpg",
        "The same test card at 2:1, so the bars are wider and the grid block is cropped off the bottom edge",
      ),
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
    webPage: {
      url: "https://example.com/design/radius-ladder",
      site: "Design notes",
      title: "The radius ladder, and why one calc() is enough",
      description:
        "A single derivation from --radius to every step, with the reason the rungs are unlayered.",
      media: cardImage("photo-wide.jpg"),
      mediaPosition: "top",
      footer: "open",
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

  // --- yesterday: the album layouter, the viewer, and the rich-text body ----
  //
  // Its own block, and its own `m-` id prefix, because every message in it is
  // about one variable — the shape of the media set or the shape of the body —
  // and a reader has to be able to scroll straight to a single case without
  // reasoning about which of the forty rows in this thread is the one they
  // want. The album sizes climb 2, 3, 4, 5 on purpose: the layouter takes a
  // different branch at each count, so an album that only ever appeared with
  // three items would leave every other branch unrendered.
  {
    id: "m-01",
    threadId: "ada",
    sender: "user",
    body: "Two, and deliberately mismatched. A 16:9 beside a 9:16 is the asymmetric case, so neither cell can be the reference and the pair has to be balanced against each other.",
    sentAt: YESTERDAY + 16 * 60 * MINUTE,
    media: [
      photo(
        "photo-landscape.jpg",
        "Test card at 16:9: six colour bars with a diagonal streak from the top left and a stepped grey grid at the lower right",
      ),
      photo(
        "photo-portrait.jpg",
        "The same test card at 9:16, with the bars running the full height and the grey grid block cropped to a sliver",
      ),
    ],
  },
  {
    id: "m-02",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "Three goes to the row-plus-feature shape, and the square is the feature. Nothing is cropped, so what you are checking is that all three cells keep the same height.",
    sentAt: YESTERDAY + 16 * 60 * MINUTE + 2 * MINUTE,
    media: [
      photo(
        "photo-wide.jpg",
        "Test card at 2:1: wide colour bars and the diagonal streak, with the grey grid block cut off by the bottom edge",
      ),
      photo(
        "photo-square.jpg",
        "Test card at 1:1, the whole pattern fitting inside the frame",
      ),
      photo(
        "photo-tall.jpg",
        "Test card at 1:2: the bars run vertically and the grey grid sits near the middle of the card",
      ),
    ],
  },
  {
    id: "m-03",
    threadId: "ada",
    sender: "user",
    body: "Four is the plain 2x2, which is the only album shape that needs no special casing at all.",
    sentAt: YESTERDAY + 16 * 60 * MINUTE + 4 * MINUTE,
    media: [
      photo(
        "photo-landscape.jpg",
        "Test card at 16:9 with six colour bars and a diagonal streak across the upper left",
      ),
      photo(
        "photo-square.jpg",
        "Test card at 1:1 with the full bar pattern and the grey grid in the lower right",
      ),
      photo(
        "photo-tall.jpg",
        "Test card at 1:2, bars running vertically, grid block visible in the middle",
      ),
      photo(
        "photo-small.jpg",
        "The test card at 300 by 200, small enough that the frame counter is the only legible detail",
      ),
    ],
  },
  {
    id: "m-04",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "Five is where the grid stops being a grid. An odd count means the last row cannot be the same width as the first, so this is the branch that actually solves for the leftover.",
    sentAt: YESTERDAY + 16 * 60 * MINUTE + 6 * MINUTE,
    media: [
      photo(
        "photo-wide.jpg",
        "Test card at 2:1, wide bars and the diagonal streak, grey grid cropped off the bottom",
      ),
      photo(
        "photo-square.jpg",
        "Test card at 1:1 with the full pattern fitting the frame",
      ),
      photo(
        "photo-landscape.jpg",
        "Test card at 16:9, six colour bars with the grey grid at the lower right",
      ),
      photo(
        "photo-tall.jpg",
        "Test card at 1:2, vertical bars with the grey grid block mid-card",
      ),
      photo(
        "photo-narrow.jpg",
        "The test card at 180 by 800: a tall sliver where the bars read as stripes and the frame counter is squeezed into the corner",
      ),
    ],
  },
  {
    id: "m-05",
    threadId: "ada",
    sender: "user",
    body: "A 2.1 pano is the other shape that reaches the complex layouter, and the reason it is worse than an odd count is that the wide one is nearly twice the ratio of everything beside it.",
    sentAt: YESTERDAY + 16 * 60 * MINUTE + 8 * MINUTE,
    media: [
      photo(
        "photo-pano.jpg",
        "Test card at 2.1:1: the widest frame here, with the colour bars stretched across it and the grey grid block pushed right",
      ),
      photo(
        "photo-square.jpg",
        "Test card at 1:1 with the full pattern inside the frame",
      ),
      photo(
        "photo-portrait.jpg",
        "Test card at 9:16, bars running the full height with the grey grid cropped to a sliver",
      ),
    ],
  },
  {
    id: "m-06",
    threadId: "ada",
    sender: "user",
    body: "",
    sentAt: YESTERDAY + 16 * 60 * MINUTE + 10 * MINUTE,
    media: [
      photo(
        "photo-square.jpg",
        "Test card at 1:1: six colour bars, a diagonal streak from the top left corner, and a stepped grey grid block at the lower right",
      ),
    ],
  },
  {
    id: "m-07",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "And the same card with a caption under it. The box cannot grow to the image's own aspect once there is a line of text beside it, so this is the one that has to fit rather than letterbox.",
    sentAt: YESTERDAY + 16 * 60 * MINUTE + 12 * MINUTE,
    media: [
      photo(
        "photo-portrait.jpg",
        "Test card at 9:16: vertical colour bars, a diagonal streak, and the grey grid block cropped to a sliver at the lower right",
      ),
    ],
  },
  {
    id: "m-08",
    threadId: "ada",
    sender: "user",
    body: "",
    sentAt: YESTERDAY + 16 * 60 * MINUTE + 14 * MINUTE,
    media: [
      video(
        "video-landscape.mp4",
        "Six-second test clip at 16:9: the colour bars hold still while the burned-in frame counter runs, and the grey grid block sits at the lower right",
      ),
    ],
  },
  {
    id: "m-09",
    threadId: "ada",
    sender: "user",
    body: "A caption under the clip. The duration badge has to stay legible against the poster, and the play mark has to sit on the bar pattern rather than on the grid.",
    sentAt: YESTERDAY + 16 * 60 * MINUTE + 16 * MINUTE,
    media: [
      video(
        "video-landscape.mp4",
        "Six-second test clip at 16:9: colour bars with a diagonal streak, a frame counter counting up in the top left, and a grey grid block at the lower right",
      ),
    ],
  },
  {
    id: "m-10",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "The portrait clip is the case where fitting to width would make the badge a strip, so the box is bounded by height instead.",
    sentAt: YESTERDAY + 16 * 60 * MINUTE + 18 * MINUTE,
    media: [
      video(
        "video-portrait.mp4",
        "Four-second test clip at 9:16: the bars run the full height, the frame counter is squeezed into the top-left corner, and the grey grid block is cropped",
      ),
    ],
  },
  {
    id: "m-11",
    threadId: "ada",
    sender: "user",
    body: "A card and a photo in one message. They are independent blocks, so neither one is allowed to reflow the other when it loads.",
    sentAt: YESTERDAY + 16 * 60 * MINUTE + 20 * MINUTE,
    media: [
      photo(
        "photo-landscape.jpg",
        "Test card at 16:9 with six colour bars, a diagonal streak from the top left, and a stepped grey grid at the lower right",
      ),
    ],
    webPage: {
      url: "https://example.com/design/geometry",
      site: "Design notes",
      title: "Fitting a card and a photo into one row",
      description:
        "Why the media block reserves its box from the intrinsic size, and why the card's own image is a separate reservation from the message's.",
      media: cardImage("photo-pano.jpg"),
      mediaPosition: "bottom",
      footer: "open",
    },
  },
  {
    id: "m-12",
    threadId: "ada",
    sender: "user",
    body: "Every shape the body parser has to tell apart, in one line: a bare link is https://example.com/geometry, a www. run is www.example.com, a trailing full stop is https://example.com/trailing. and foo.zzz is not a url so it has to stay plain text. Mail goes to ada@example.com, ping @ada, file it under #geometry — and https://аррӏе.com is not what it looks like.",
    sentAt: YESTERDAY + 16 * 60 * MINUTE + 22 * MINUTE,
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

  // The album layouter, one count per state, because the count is the only
  // input that changes which branch runs. Two and three are the shapes a
  // symmetric grid cannot express; four is the one it can; five and the pano
  // are both the complex layouter, reached for different reasons.
  "album-2": slice("m-01"),
  "album-3": slice("m-02"),
  "album-4": slice("m-03"),
  "album-5": slice("m-04"),
  "album-pano": slice("m-05"),

  // A single photo with no body at all, then the same card with one. The pair
  // is the point: an empty body has to leave the media its full box rather than
  // reserve room for a caption that never arrives.
  "media-only": slice("m-06"),
  "photo-caption": slice("m-07"),

  // A clip with no body, a clip with one, and the portrait clip, which is the
  // one whose fitted box is bounded by height rather than width.
  video: slice("m-08"),
  "video-caption": slice("m-09"),
  "video-portrait": slice("m-10"),

  // Media and a card in one row: two independent reservations, and a card
  // whose image is on the bottom edge rather than the top.
  "media-card": slice("m-11"),

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
};

/** The message `firstUnreadIndex` anchors on in the `unread` state. */
export const UNREAD_ANCHOR_ID = "a-37";

