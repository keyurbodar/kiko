// The one piece of state more than one slice needs: which conversation is
// open, and the messages in it. Sidebar writes the selection, chat reads it,
// composer writes messages — so it is owned here rather than invented twice.
//
// Deliberately a plain Solid store, not a library. solid-js/store is already a
// dependency; adding a state manager on top would be weight with nothing to
// manage yet.

import { createStore, produce } from "solid-js/store"
import { BOTS, GROUPS, MESSAGES, VIEWER_ID } from "./fixtures"
import type { ChatMessage, OutgoingMessage, RosterBot, RosterGroup } from "./types"

let sentCount = 0

function nextMessageId(): string {
  sentCount += 1
  return `sent-${sentCount}`
}

function isSendable(message: OutgoingMessage): boolean {
  if (message.body.trim().length > 0) return true
  return (message.media?.length ?? 0) > 0 || (message.documents?.length ?? 0) > 0
}

function sentMessage(
  id: string,
  threadId: string,
  message: OutgoingMessage,
  sentAt: number,
  replyToId?: string,
): ChatMessage {
  const sent: ChatMessage = {
    id,
    threadId,
    sender: "user",
    body: message.body,
    sentAt,
  }
  if (message.media !== undefined && message.media.length > 0) sent.media = message.media
  if (message.documents !== undefined && message.documents.length > 0) sent.documents = message.documents
  if (message.webPage !== undefined) sent.webPage = message.webPage
  if (replyToId !== undefined) sent.replyToId = replyToId
  return sent
}

const [state, setState] = createStore({
  bots: BOTS as RosterBot[],
  groups: GROUPS as RosterGroup[],
  messages: MESSAGES as ChatMessage[],
  activeThreadId: BOTS[0]?.id ?? null,
})

export const useApp = {
  /** Read by every slice. Reactive where read inside a JSX scope. */
  bots: () => state.bots,
  groups: () => state.groups,
  viewerId: VIEWER_ID,

  activeThreadId: () => state.activeThreadId,

  /** Bots by id, for avatars and names in a thread. */
  botById(): ReadonlyMap<string, RosterBot> {
    return new Map(state.bots.map((bot) => [bot.id, bot]))
  },

  /** Messages for the open conversation, oldest first. */
  activeMessages(): readonly ChatMessage[] {
    const id = state.activeThreadId
    return id ? state.messages.filter((message) => message.threadId === id) : []
  },

  selectThread(threadId: string) {
    setState("activeThreadId", threadId)
  },

  /** Messages for any conversation by id, for resolving a reply's parent. */
  messageById(messageId: string): ChatMessage | undefined {
    return state.messages.find((message) => message.id === messageId)
  },

  /**
   * The viewer is at most one reactor per chip, so each emoji is toggled on its
   * own. The chip is mutated in place: rebuilding the array would hand every
   * other chip a new object and lose the pressed state of the rest.
   */
  toggleReaction(messageId: string, emoji: string) {
    setState(
      "messages",
      produce((draft) => {
        for (const message of draft) {
          if (message.id !== messageId) continue
          const reactions = message.reactions ?? []
          const chip = reactions.find((reaction) => reaction.emoji === emoji)
          if (!chip) {
            message.reactions = [...reactions, { emoji, count: 1, viewerReacted: true }]
            return
          }
          if (chip.viewerReacted) {
            chip.count -= 1
            if (chip.count <= 0) {
              message.reactions = reactions.filter((reaction) => reaction !== chip)
            } else {
              chip.viewerReacted = false
            }
            return
          }
          chip.count += 1
          chip.viewerReacted = true
        }
      }),
    )
  },

  appendReply(message: OutgoingMessage, replyToId: string, sentAt: number): string | undefined {
    const threadId = state.activeThreadId
    if (!threadId || !replyToId || !isSendable(message)) return undefined
    if (!state.messages.some((existing) => existing.id === replyToId && existing.threadId === threadId)) return undefined

    const id = nextMessageId()
    setState(
      "messages",
      produce((draft) => {
        draft.push(sentMessage(id, threadId, message, sentAt, replyToId))
      }),
    )
    return id
  },

  appendMessage(message: OutgoingMessage, sentAt: number): string | undefined {
    const threadId = state.activeThreadId
    if (!threadId || !isSendable(message)) return undefined

    const id = nextMessageId()
    setState(
      "messages",
      produce((draft) => {
        draft.push(sentMessage(id, threadId, message, sentAt))
      }),
    )
    return id
  },

  markRead(threadId: string) {
    setState(
      "bots",
      produce((draft) => {
        for (const bot of draft) {
          if (bot.id === threadId) bot.unread = 0
        }
      }),
    )
  },

  /**
   * The mirror of `markRead`, and it has to set a count rather than increment
   * one: the row renders "unread" as a state, not a tally, so a bot at zero is
   * put back to one unread rather than to whatever it had before.
   */
  markUnread(threadId: string) {
    setState(
      "bots",
      produce((draft) => {
        for (const bot of draft) {
          if (bot.id === threadId && bot.unread === 0) bot.unread = 1
        }
      }),
    )
  },

  /** Pinned bots are lifted into the sidebar's tile grid; the order is not. */
  togglePinned(threadId: string) {
    setState(
      "bots",
      produce((draft) => {
        for (const bot of draft) {
          if (bot.id === threadId) bot.pinned = !bot.pinned
        }
      }),
    )
  },

  /**
   * Messages for any conversation by id, oldest first. `activeMessages` is the
   * same read narrowed to the open thread; the hover preview needs it for a
   * thread that is not open, which is the whole reason it exists.
   */
  messagesFor(threadId: string): readonly ChatMessage[] {
    return state.messages.filter((message) => message.threadId === threadId)
  },
}
