import type { ChatMessage } from "../../lib/types"

export const MESSAGE_GROUPING_WINDOW_MS = 10 * 60_000

export type TimelineItem =
  | { kind: "day-divider"; key: string; dayStart: number }
  | {
      kind: "message"
      key: string
      message: ChatMessage
      isContinuation: boolean
      isFollowedByContinuation: boolean
    }

export function sameAuthor(previous: ChatMessage, current: ChatMessage): boolean {
  if (previous.sender !== current.sender) return false
  if (previous.sender === "user") return true
  return previous.botId !== undefined && previous.botId === current.botId
}

export function isContinuation(previous: ChatMessage, current: ChatMessage): boolean {
  if (previous.replyToId !== undefined || current.replyToId !== undefined) return false
  if (!sameAuthor(previous, current)) return false
  const gap = current.sentAt - previous.sentAt
  return gap >= 0 && gap <= MESSAGE_GROUPING_WINDOW_MS
}

export function dayStartOf(sentAt: number): number {
  const day = new Date(sentAt)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

export function buildTimelineItems(messages: readonly ChatMessage[]): TimelineItem[] {
  const items: TimelineItem[] = []
  let openDay: number | undefined

  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i]
    const dayStart = dayStartOf(message.sentAt)

    if (dayStart !== openDay) {
      items.push({ kind: "day-divider", key: `day-${dayStart}`, dayStart })
      openDay = dayStart
    }

    const previous = messages[i - 1]
    const next = messages[i + 1]
    const continues = previous !== undefined && isContinuation(previous, message)

    items.push({
      kind: "message",
      key: message.id,
      message,
      isContinuation: continues,
      isFollowedByContinuation:
        next !== undefined && dayStartOf(next.sentAt) === dayStart && isContinuation(message, next),
    })
  }

  return items
}

export function firstUnreadIndex(
  items: readonly TimelineItem[],
  firstUnreadMessageId: string | null,
): number {
  if (firstUnreadMessageId === null) return -1
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    if (item.kind === "message" && item.message.id === firstUnreadMessageId) return i
  }
  return -1
}
