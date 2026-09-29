// v1 domain contract. Frozen before the UI slices were fanned out, so chat,
// composer, and sidebar can be built side by side against the same shapes.
//
// v1 is text only: no attachments, no markdown, no code blocks, no tool calls.
// Anything that would render a non-text payload is deliberately absent rather
// than stubbed — a later data layer has to satisfy these types, so widening
// them later is the expensive direction and narrowing them is free.

export type BotPresence = "idle" | "typing" | "working" | "sleeping";

export interface RosterBot {
  id: string;
  name: string;
  /** One-line preview of the last exchange, shown under the name. */
  preview: string;
  /** Epoch ms of the last activity; the sidebar renders this relatively. */
  updatedAt: number;
  presence: BotPresence;
  unread: number;
  pinned: boolean;
  /** Free-form persona blurb. Rendered in the row's second line when present. */
  persona?: string;
  /** Tints the author name the way Discord tints a member by role. */
  color?: string;
  /** Uploaded avatar as a data URL. Absent means derive one from the name. */
  avatarImage?: string;
}

export interface RosterGroup {
  id: string;
  name: string;
  memberIds: string[];
  updatedAt: number;
}

export interface Reaction {
  emoji: string;
  count: number;
  /** True when the viewer is among the reactors, so the chip reads as pressed. */
  viewerReacted: boolean;
}

/** A single message in a conversation. Text only, by v1 decision. */
export interface ChatMessage {
  id: string;
  /** Which conversation this belongs to: a bot id or a group id. */
  threadId: string;
  /** Who sent it. "user" is the person typing in the composer. */
  sender: "user" | "bot";
  /** Bot id when `sender` is "bot". */
  botId?: string;
  body: string;
  /** Epoch ms, used for date dividers and the per-message timestamp. */
  sentAt: number;
  reactions?: readonly Reaction[];
  /** The message this one answers. Absent on a root message. */
  replyToId?: string;
}

/** What the sidebar renders for one conversation. Either kind, never both. */
export type Thread =
  | { kind: "bot"; id: string; bot: RosterBot; messageCount: number }
  | { kind: "group"; id: string; group: RosterGroup; messageCount: number };

/** Props every slice receives. Kept flat so a slice never imports another. */
export interface SidebarProps {
  bots: readonly RosterBot[];
  groups: readonly RosterGroup[];
  /** Currently open conversation, or null before one is picked. */
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
}

export interface ChatProps {
  /** The open conversation's messages, oldest first. */
  messages: readonly ChatMessage[];
  /** Lookup for avatars and names; a thread may reference any bot id. */
  bots: ReadonlyMap<string, RosterBot>;
  /** Who the person typing is, so the thread can render their own messages. */
  viewerId: string;
}

export interface ComposerProps {
  /** Conversation a sent message lands in. */
  threadId: string;
  onSend: (body: string) => void;
  /** Roster the `@` menu filters. A mention is text; this is the only source. */
  bots: readonly RosterBot[];
  /** Disables send while a send is in flight. */
  busy?: boolean;
}
