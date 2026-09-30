import type { JSX } from "solid-js"
import type { ChatMessage, RosterBot } from "../lib/types"
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
  /**
   * Controlled reply target. When this prop is supplied the transcript stops
   * owning the reply and renders whatever the parent says; `null` means no
   * reply. Leave it out and the transcript keeps its internal signal, which is
   * what the harness relies on.
   */
  replyTarget?: string | null
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
