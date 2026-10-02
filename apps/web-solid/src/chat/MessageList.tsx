import type { JSX } from "solid-js"
import type { ChatMessage, RosterBot } from "../lib/types"
import type { DraftBook } from "../warm/drafts"
import type { Notice } from "./lib/grouping"
import { VirtualThread, type VirtualThreadState } from "./VirtualThread"

/**
 * The transcript surface.
 *
 * Deliberately the same props as `VirtualThread`, passed straight through: a
 * second signature here would be a second place for the harness and the app to
 * disagree about what a thread needs. What this adds is the name the rest of
 * the app imports — `VirtualThread` is the implementation, this is the surface.
 */
export function MessageList(props: {
  messages: readonly ChatMessage[]
  botById: (botId: string | undefined) => RosterBot | undefined
  replyParent: (messageId: string | undefined) => ChatMessage | undefined
  firstUnreadMessageId: string | null
  onJumpToMessage: (messageId: string) => void
  onReplyTarget: (messageId: string) => void
  scrollRef: (element: HTMLDivElement | undefined) => void
  onStateChange: (state: VirtualThreadState) => void
  waitingNames: readonly string[]
  /** The typing agents' slugs, same order as `waitingNames`, for the avatar. */
  waitingSlugs?: readonly string[]
  groupChat?: boolean
  /** The room's member slugs, so an agent's message to another member folds into a thread. */
  memberSlugs?: readonly string[]
  /** Who joined and left, as muted lines. */
  notices?: readonly Notice[]
  /** The viewer tapped an emoji on a message. */
  onReact?: (messageId: string, emoji: string) => void
  /**
   * Controlled reply target. When this prop is supplied the transcript stops
   * owning the reply and renders whatever the parent says; `null` means no
   * reply. Leave it out and the transcript keeps its internal signal, which is
   * what the harness relies on.
   */
  replyTarget?: string | null
  scrollKey?: string
  scrollBook?: Pick<DraftBook, "scroll" | "saveScroll">
  /** Receives a stable jump function for the transcript's scroller. */
  onJumpHandle?: (handle: {
    /** Scroll to a message and mark where it landed. */
    jumpToMessage: (messageId: string) => void
    /** Scroll to the end without marking anything. */
    scrollToLatest: () => void
  }) => void
}): JSX.Element {
  return <VirtualThread {...props} />
}

export type { VirtualThreadState } from "./VirtualThread"
