// Domain contract, frozen before the UI slices were fanned out so chat,
// composer, and sidebar build side by side against the same shapes.
//
// v1 is text-first. Everything the transcript can show on top of a text body
// is optional rather than absent, because a message is one row: widening these
// to carry an image, a link card, or a send state is cheap now and expensive
// once a data layer has to satisfy them. Fields stay optional so the store's
// `appendMessage` keeps working with a body and nothing else — and a send that
// carries attachments says so with an `OutgoingMessage` rather than by making
// the body optional.

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

/**
 * One picture or clip a message carries.
 *
 * `kind` is what picks the chrome: a video draws a duration badge and a play
 * mark over its poster frame, a photo draws nothing over itself. The intrinsic
 * size is required rather than optional, because the box is reserved from it
 * before the bytes land — an album whose cells resize on load would move the
 * scroll anchor of every row below it.
 */
export interface MediaItem {
  kind: "photo" | "video"
  src: string
  /** Intrinsic size in pixels, not layout size. */
  width: number
  height: number
  /** Frame shown before a video plays. Ignored on a photo. */
  poster?: string
  /** Clip length in seconds, for the duration badge. */
  duration?: number
  /** Describes the media for assistive tech and for the viewer's caption. */
  alt: string
}

/**
 * The card a message renders when its body points at a page that described
 * itself. `mediaSize` picks the Telegram layout: `large` draws the picture under
 * the text at the card's full width, `small` draws a 48px thumbnail at the
 * card's trailing edge beside the text.
 */
export interface WebPagePreview {
  url: string
  site?: string
  title?: string
  description?: string
  media?: { src: string; width: number; height: number }
  mediaSize?: "large" | "small"
}

/** A file a message carries that is not a picture: a PDF, an archive, a text file. */
export interface DocumentItem {
  name: string
  /** Bytes. */
  size: number
  mime: string
  src: string
}


/** A single message in a conversation. A media-only message has an empty body. */
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
   * The message's media, in the order the sender attached it. One item draws
   * as a single fitted box and two or more draw as an album grid, which is the
   * same split tweb makes between its photo path and its album layouter.
   */
  media?: MediaItem[]
  /** Files that are not pictures, drawn as document rows in the same bubble. */
  documents?: DocumentItem[]
  /** Shows the edited marker. The body is never rewritten, only flagged. */
  edited?: boolean
  /** Marks the message as pinned in its thread. */
  pinned?: boolean
  /** The card rendered from the metadata of a page the body points at. */
  webPage?: WebPagePreview
  /**
   * Optimistic send state for the viewer's own messages. A bot message is
   * never in flight, so this only ever reads on a `sender: "user"` row.
   */
  status?: "sending" | "sent" | "failed";
}

/**
 * What the composer hands the app on a send.
 *
 * `body` stays a required string rather than becoming optional, because a
 * media-only message is `body: ""` — the shape the fixtures already use for an
 * attachment-only message — and every reader of `ChatMessage.body` (the
 * caption block, the height model, the reply quote) asks whether it is empty,
 * not whether it exists. Making it optional would push that same question into
 * every one of those readers for no gain.
 */
export interface OutgoingMessage {
  body: string
  /** The attachments, in the order they were added to the composer. */
  media?: MediaItem[]
  documents?: DocumentItem[]
  /** The preview the composer resolved for the draft's link, unless dismissed. */
  webPage?: WebPagePreview
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
  /** A send carries its text and its attachments together. */
  onSend: (message: OutgoingMessage) => void;
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
