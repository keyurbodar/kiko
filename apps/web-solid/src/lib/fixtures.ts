// Static v1 data. There is no backend, no database, and no networking: every
// state the UI can reach has to be reachable from here, which is the point of
// building the interface first.

import type { ChatMessage, RosterBot, RosterGroup } from "./types";

export const VIEWER_ID = "viewer";

export const BOTS: readonly RosterBot[] = [
  {
    id: "ada",
    name: "Ada",
    preview: "Shipped the token bridge this morning.",
    updatedAt: 1759100000000,
    presence: "idle",
    unread: 0,
    pinned: true,
    persona: "Systems engineer. Concise, allergic to hand-waving.",
  },
  {
    id: "grace",
    name: "Grace",
    preview: "I can take the sidebar slice.",
    updatedAt: 1759090000000,
    presence: "working",
    unread: 2,
    pinned: true,
  },
  {
    id: "alan",
    name: "Alan",
    preview: "Working on the composer draft handling.",
    updatedAt: 1759080000000,
    presence: "typing",
    unread: 1,
    pinned: false,
  },
  {
    id: "katherine",
    name: "Katherine",
    preview: "Standup notes are in the thread above.",
    updatedAt: 1758900000000,
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
    updatedAt: 1759100000000,
  },
];

const DAY = 86_400_000;

export const MESSAGES: readonly ChatMessage[] = [
  {
    id: "m1",
    threadId: "ada",
    sender: "user",
    body: "Where did the radius ladder land?",
    sentAt: 1759100000000 - DAY,
  },
  {
    id: "m2",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "One :root block in kiko.css. The whole scale is calc() off a single --radius.",
    sentAt: 1759100000000 - DAY + 60_000,
  },
  {
    id: "m3",
    threadId: "ada",
    sender: "user",
    body: "And the duplicate declaration?",
    sentAt: 1759100000000 - DAY + 120_000,
  },
  {
    id: "m4",
    threadId: "ada",
    sender: "bot",
    botId: "ada",
    body: "Gone. Tailwind v4 already registers the names, so the @theme block was redundant.",
    sentAt: 1759100000000 - DAY + 180_000,
  },
  {
    id: "m5",
    threadId: "grace",
    sender: "bot",
    botId: "grace",
    body: "Taking the sidebar. I will own sidebar.css outright.",
    sentAt: 1759090000000,
  },
  {
    id: "m6",
    threadId: "alan",
    sender: "bot",
    botId: "alan",
    body: "Composer is mine. Send is optimistic, no server round trip in v1.",
    sentAt: 1759080000000,
  },
];
