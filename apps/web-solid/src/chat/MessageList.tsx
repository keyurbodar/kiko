import type { JSX } from "solid-js"
import type { ChatMessage, RosterBot } from "../lib/types"
import type { DraftBook } from "../warm/drafts"
import { VirtualThread, type VirtualThreadState } from "./VirtualThread"

export function MessageList(props: {
  messages: readonly ChatMessage[]
  botById: (botId: string | undefined) => RosterBot | undefined
  replyParent: (messageId: string | undefined) => ChatMessage | undefined
  firstUnreadMessageId: string | null
  onJumpToMessage: (messageId: string) => void
  onReplyTarget: (messageId: string) => void
  onJumpToSeq?: (messageId: string, seq: number) => void
  scrollRef: (element: HTMLDivElement | undefined) => void
  onStateChange: (state: VirtualThreadState) => void
  waitingNames: readonly string[]
  waitingSlugs?: readonly string[]
  waitingDoings?: readonly (string | undefined)[]
  groupChat?: boolean
  memberSlugs?: readonly string[]
  onReact?: (messageId: string, emoji: string) => void
  onEdit?: (messageId: string) => void
  onDelete?: (messageId: string) => void
  replyTarget?: string | null
  onNearTop?: () => void
  onAtLatest?: () => void
  onLeftLatest?: () => void
  scrollKey?: string
  scrollBook?: Pick<DraftBook, "scroll" | "saveScroll"> & Partial<Pick<DraftBook, "ready">>
  onJumpHandle?: (handle: {
    jumpToMessage: (messageId: string) => void
    scrollToLatest: () => void
  }) => void
}): JSX.Element {
  return <VirtualThread {...props} />
}

export type { VirtualThreadState } from "./VirtualThread"
