// The view types the components draw. The data behind them is the protocol:
// `Message`, `Member`, and `Chat` from `@kiko/protocol`, held by the sync
// stores. `lib/store.ts` turns each protocol value into one of these shapes in
// one place, so no component reads a wire type and none invents one.
//
// DEVIATION: the transcript keeps a message view (`ChatMessage`) instead of
// reading `Message` directly. Its height model, grouping, quote, and menu all
// read this shape, and none of those files belongs to P2-07. The view is now
// derived from `Message` by `toChatMessage`, and only the store and the dev
// harness fixtures build one.

import type { MessageId, RichText } from "@kiko/protocol";

export type BotPresence = "idle" | "typing" | "working" | "sleeping";

/**
 * An avatar with a name. The sidebar draws a chat as one (`id` is the room id),
 * and the transcript draws each room member as one (`id` is the agent slug).
 */
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
}

/**
 * One chip under a message: an emoji and how many reacted with it. The protocol
 * stores at most one reaction per actor (`Reaction` in `@kiko/protocol`), and
 * the store folds those into chips.
 */
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

/**
 * A single message as the transcript draws it. The store builds it from a
 * protocol `Message` with `toChatMessage`. A media-only message has an empty body.
 */
export interface ChatMessage {
  /** The protocol `MessageId`, or `local:<clientId>` while a send is unacknowledged. */
  id: MessageId | string;
  /** The room it belongs to. */
  threadId: string;
  /** Who sent it. "user" is the person typing in the composer. */
  sender: "user" | "bot";
  /** The agent slug when an agent wrote it. Absent on a system message. */
  botId?: string;
  /** The room's sequence. Absent in harness fixtures and on a pending send. */
  seq?: number;
  /** Plain text. An agent message also carries `rich`. */
  body: string;
  /** The tree the server parsed from an agent's markdown. */
  rich?: RichText;
  /** Epoch ms, used for date dividers and the per-message timestamp. */
  sentAt: number;
  /**
   * One chip per emoji, each carrying its own count. `viewerReacted` is per
   * chip, so the chip the viewer chose reads as pressed.
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
  /**
   * Names the draft the input shows. When it changes the input is refilled from
   * `draftFor`, in the same frame. Empty means no draft is loaded yet.
   */
  draftKey?: string;
  draftFor?: (key: string) => string;
  /** The text changed. Called only for the loaded `draftKey`. */
  onDraftChange?: (key: string, text: string) => void;
}
