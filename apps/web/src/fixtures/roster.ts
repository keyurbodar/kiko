import type { RosterBot, RosterGroup } from "../lib/roster";

const MINUTE_MS = 60_000;

const minutesAgo = (minutes: number) => Date.now() - minutes * MINUTE_MS;

export const FIXTURE_BOTS: RosterBot[] = [
  {
    id: "chief",
    name: "Chief",
    persona: "Keeps the week honest and the calendar clean.",
    pinned: true,
    presence: "idle",
    preview: "Offsite is booked — agenda goes out Friday.",
    unread: 0,
    updatedAt: minutesAgo(4),
  },
  {
    id: "sales-outbound",
    name: "Sales Outbound",
    pinned: false,
    presence: "idle",
    preview: "Meridian follow-up is parked in your outbox.",
    unread: 2,
    updatedAt: minutesAgo(38),
  },
  {
    id: "inbox-manager",
    name: "Inbox Manager",
    pinned: false,
    presence: "idle",
    preview: "12 threads triaged, 3 need you.",
    unread: 0,
    updatedAt: minutesAgo(96),
  },
  {
    id: "account-manager",
    name: "Account Manager",
    pinned: false,
    presence: "idle",
    preview: "Globex note is ready to send.",
    unread: 0,
    updatedAt: minutesAgo(180),
  },
  {
    id: "talent-scout",
    name: "Talent Scout",
    pinned: false,
    presence: "sleeping",
    preview: "Two interviews to reschedule.",
    unread: 0,
    updatedAt: minutesAgo(420),
  },
  {
    id: "expense-manager",
    name: "Expense Manager",
    pinned: false,
    presence: "idle",
    preview: "Q3 receipts are reconciled.",
    unread: 0,
    updatedAt: minutesAgo(1440),
  },
];

export const FIXTURE_GROUPS: RosterGroup[] = [
  {
    id: "offsite-crew",
    memberIds: ["chief", "account-manager", "inbox-manager", "talent-scout"],
    name: "Offsite Crew",
    updatedAt: minutesAgo(28),
  },
];
