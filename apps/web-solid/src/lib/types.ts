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

import type { MessageId, PendingAttachment, RichText } from "@kiko/protocol";

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
  /** Who the preview is from (`you`, or an agent in a group), drawn before it. */
  previewFrom?: string;
  /** Who is typing, in words, while `presence` is `typing`: `typing`, or `ada is typing` in a group. */
  typing?: string;
  /** Unread messages that mention the human or reply to them: the row's @ badge. */
  mentions?: number;
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
 * A file the human attached to a message. Its type tells a picture from any other file
 * (`lib/attachments.ts`), so an old message stored with media draws the same way.
 */
export interface MessageFile {
  /** The name the human gave it. */
  name: string
  /** The file's path in the room, once stored. The files tab opens it by this. Absent while it uploads. */
  path?: string
  /** Bytes. */
  size: number
  type: string
  /** The server's URL, or a blob URL while the upload runs. */
  src: string
}

/**
 * A single message as the transcript draws it. The store builds it from a
 * protocol `Message` with `toChatMessage`. A message of only attachments has an empty body.
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
  /** The human's attachments, in the order they were added. */
  files?: MessageFile[]
  /** Shows the edited marker. The body is never rewritten, only flagged. */
  edited?: boolean
  /** A chat this message points to, such as the one kiko just made. */
  goto?: string
  /** The words of the replied-to message this one answers, shown in its reply header. */
  quote?: string
  /** Marks the message as pinned in its thread. */
  pinned?: boolean
  /**
   * Optimistic send state for the viewer's own messages. A bot message is
   * never in flight, so this only ever reads on a `sender: "user"` row.
   */
  status?: "sending" | "sent" | "failed";
}

/**
 * What the composer hands the app on a send.
 *
 * A message of only attachments has `body: ""`.
 */
export interface OutgoingMessage {
  body: string
  /** The attachments, in the order they were added, drawn from blob URLs until the room's copy arrives. */
  files?: MessageFile[]
  /** The same attachments as the uploads the room claims, in the same order. */
  attachments?: PendingAttachment[]
}

export interface ComposerProps {
  /** Conversation a sent message lands in. */
  threadId: string;
  /** The chat's name. The placeholder reads `message <title>`, the way kat's reads `message kat`. */
  title?: string;
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
  /** One of the human's own messages being edited: the composer holds its text, and a send replaces it. */
  editing?: ChatMessage | null;
  onEdit?: (messageId: string, text: string) => void;
  onCancelEdit?: () => void;
  /** Up arrow in an empty composer: edit the human's last message, as in Telegram. */
  onEditLast?: () => void;
  /** The words of the reply target being answered, shown in the reply bar in place of its start. */
  replyQuote?: string;
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
