import type { JSX } from "solid-js"
import type { ChatMessage, RosterBot } from "../lib/types"
import { VirtualThread, type VirtualThreadState } from "./VirtualThread"
import "./chat.css"

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
}): JSX.Element {
  return <VirtualThread {...props} />
}

export type { VirtualThreadState } from "./VirtualThread"
