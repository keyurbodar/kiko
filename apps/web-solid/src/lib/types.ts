import type { JSX } from "solid-js"

import type { MessageId, PendingAttachment, RichText } from "@kiko/protocol"

export type BotPresence = "idle" | "typing" | "working" | "sleeping"

export interface RosterBot {
  id: string
  name: string
  preview: string
  previewFrom?: string
  typing?: string
  mentions?: number
  updatedAt: number
  lastFrom?: "human" | "agent" | "system"
  presence: BotPresence
  unread: number
  pinned: boolean
  persona?: string
  color?: string
}

export interface Reaction {
  emoji: string
  count: number
  viewerReacted: boolean
}

export interface MessageFile {
  name: string
  path?: string
  size: number
  type: string
  src: string
}

export interface ChatMessage {
  id: MessageId | string
  clientId?: string
  threadId: string
  sender: "user" | "bot"
  botId?: string
  seq?: number
  body: string
  rich?: RichText
  sentAt: number
  reactions?: Reaction[]
  replyToId?: string
  reply?: import("@kiko/protocol").ReplyPreview
  files?: MessageFile[]
  edited?: boolean
  event?: import("@kiko/protocol").Message["event"]
  goto?: string
  quote?: string
  initiative?: string
  to?: string
  steps?: number
  stepAfter?: number
  pinned?: boolean
  status?: "sending" | "sent" | "failed"
}

export interface OutgoingMessage {
  body: string
  files?: MessageFile[]
  attachments?: PendingAttachment[]
}

export interface ComposerProps {
  room?: import("../state/room").ActiveRoom
  tray?: JSX.Element
  threadId: string
  title?: string
  onSend: (message: OutgoingMessage) => boolean | void
  bots: readonly RosterBot[]
  busy?: boolean
  replyTo?: ChatMessage | null
  onClearReply?: () => void
  editing?: ChatMessage | null
  onEdit?: (messageId: string, text: string) => void
  onCancelEdit?: () => void
  onEditLast?: () => void
  sendBlock?: import("../settings/send-block").SendBlock | null
  sendBlockAgent?: string
  replyQuote?: string
  onJumpToReply?: (messageId: string) => void
  draftKey?: string
  draftFor?: (key: string) => string
  onDraftChange?: (key: string, text: string) => void
}
