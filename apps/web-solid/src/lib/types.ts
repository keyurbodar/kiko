// Domain contract, frozen before the UI slices were fanned out so chat,
// composer, and sidebar build side by side against the same shapes.
//
// v1 is text-first. Everything the transcript can show on top of a text body
// is optional rather than absent, because a message is one row: widening these
// to carry an image, a link card, or a send state is cheap now and expensive
// once a data layer has to satisfy them. Fields stay optional so the store's
// `appendMessage` keeps working with a body and nothing else.

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

/** A single message in a conversation. Text is required; the rest is display. */
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
  /**
   * One chip per emoji, each carrying its own count. Every person is at most
   * one reactor on any chip, so `viewerReacted` is per chip rather than per
   * message: reacting with a second emoji must not disturb the first.
   */
  reactions?: Reaction[];
  /** The message this one answers. Absent on a root message. */
  replyToId?: string;
  /**
   * Intrinsic size, not layout size. The row reserves `width` x `height`
   * before the bytes land, so a decoding image cannot shift the scroll anchor.
   */
  image?: {
    src: string;
    alt: string;
    width: number;
    height: number;
  };
  /** Shows the edited marker. The body is never rewritten, only flagged. */
  edited?: boolean;
  /** Marks the message as pinned in its thread. */
  pinned?: boolean;
  /**
   * A card rendered from link metadata. Carries no image: a preview is text
   * plus a host, and a card that needs a thumbnail is an attachment.
   */
  linkPreview?: {
    url: string;
    title: string;
    description?: string;
    /** Display name for the host, when it differs from the raw hostname. */
    site?: string;
  };
  /**
   * Optimistic send state for the viewer's own messages. A bot message is
   * never in flight, so this only ever reads on a `sender: "user"` row.
   */
  status?: "sending" | "sent" | "failed";
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
  /**
   * The message the composer is quoting, or null. Owned by the app rather than
   * the composer, because the swipe gesture that arms a reply lives in the
   * transcript and both surfaces have to agree on it.
   */
  replyTo?: ChatMessage | null;
  /** Drop the reply, after a send or when the reader dismisses the bar. */
  onClearReply?: () => void;
  /** Scroll the transcript to the quoted message. */
  onJumpToReply?: (messageId: string) => void;
}
