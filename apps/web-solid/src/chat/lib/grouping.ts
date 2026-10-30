import { createSignal, type Setter } from "solid-js"
import type { ChatMessage } from "../../lib/types"
import { dayStartOf } from "./day-start"
import { startsTimeBreak } from "./time-label"

const MESSAGE_GROUPING_WINDOW_MS = 300_000

export type TimelineItem =
  | {
      kind: "day-divider"
      key: string
      dayStart: number
      firstSentAt: number
    }
  | { kind: "unread-divider"; key: string; afterMessageId: string }
  | { kind: "event"; key: string; message: ChatMessage }
  | {
      kind: "thread"
      key: string
      messages: readonly ChatMessage[]
      slugs: readonly string[]
      expanded: boolean
    }
  | { kind: "background"; key: string; slug: string; messages: readonly ChatMessage[]; expanded: boolean }
  | {
      kind: "message"
      key: string
      message: ChatMessage
      foldedRuns?: readonly ChatMessage[]
      runKey: string
      runIndex: number
      runSize: number
      isRunStart: boolean
      isRunEnd: boolean
      hasRunGapBefore: boolean
    }

export type TimelineOptions = {
  members?: ReadonlySet<string>
  expanded?: ReadonlySet<string>
}

export { dayStartOf }

function canGroup(a: ChatMessage, b: ChatMessage): boolean {
  if (a.sender !== b.sender) return false
  if (a.botId !== b.botId) return false
  if (a.replyToId !== undefined || b.replyToId !== undefined) return false
  if (dayStartOf(a.sentAt) !== dayStartOf(b.sentAt)) return false
  const gap = b.sentAt - a.sentAt
  return gap >= 0 && gap <= MESSAGE_GROUPING_WINDOW_MS
}

const addressee = (message: ChatMessage): string | undefined => (message.sender === "bot" ? message.to : undefined)

type Entry =
  | { kind: "message"; message: ChatMessage; inThread: boolean; foldedRuns?: ChatMessage[] }
  | { kind: "event"; message: ChatMessage }
  | { kind: "thread"; key: string; messages: ChatMessage[]; slugs: string[]; expanded: boolean }
  | { kind: "background"; key: string; slug: string; messages: ChatMessage[]; expanded: boolean }

const isEvent = (m: ChatMessage) => m.event !== undefined || m.goto !== undefined

const backgroundOf = (m: ChatMessage) => (m.event?.kind === "activity" && m.botId && m.steps ? m.botId : undefined)

const senderKey = (m: ChatMessage) => (m.sender === "user" ? "user" : (m.botId ?? ""))

type Folds = { byTarget: Map<string, ChatMessage[]>; waiting: Map<string, ChatMessage[]>; taken: Set<string> }

function folds(messages: readonly ChatMessage[]): Folds {
  const byTarget = new Map<string, ChatMessage[]>()
  const waiting = new Map<string, ChatMessage[]>()
  const taken = new Set<string>()
  for (const message of messages) {
    const activity = backgroundOf(message)
    const key = activity ?? senderKey(message)
    const held = waiting.get(key)
    const target = !activity && held && message.sender === "bot" && message.steps && !message.to && !isEvent(message)
    if (target) {
      byTarget.set(message.id, held!)
      waiting.delete(key)
    }
    for (const other of waiting.keys()) if (other !== key) waiting.delete(other)
    if (!activity) continue
    if (held) held.push(message)
    else waiting.set(key, [message])
  }
  for (const list of byTarget.values()) for (const message of list) taken.add(message.id)
  return { byTarget, waiting, taken }
}

export function unfoldedRuns(messages: readonly ChatMessage[], slug: string): readonly ChatMessage[] {
  return folds(messages).waiting.get(slug) ?? []
}

function addBackground(out: Entry[], message: ChatMessage, slug: string, options: TimelineOptions): void {
  const last = out.at(-1)
  if (last?.kind === "background" && last.slug === slug) {
    last.messages.push(message)
    return
  }
  const key = `background:${message.id}`
  out.push({ kind: "background", key, slug, messages: [message], expanded: options.expanded?.has(key) ?? false })
}

function entries(messages: readonly ChatMessage[], options: TimelineOptions, fold: Folds): Entry[] {
  const out: Entry[] = []
  let thread: Extract<Entry, { kind: "thread" }> | null = null
  const close = () => {
    if (!thread) return
    out.push(thread)
    if (thread.expanded) for (const message of thread.messages) out.push({ kind: "message", message, inThread: true })
    thread = null
  }
  for (const message of messages) {
    const background = backgroundOf(message)
    if (background) {
      close()
      if (!fold.taken.has(message.id)) addBackground(out, message, background, options)
      continue
    }
    if (isEvent(message)) {
      close()
      out.push({ kind: "event", message })
      continue
    }
    const foldedRuns = fold.byTarget.get(message.id)
    const to = options.members ? addressee(message) : undefined
    if (to === undefined) {
      close()
      out.push({ kind: "message", message, inThread: false, ...(foldedRuns ? { foldedRuns } : {}) })
      continue
    }
    if (!thread) {
      const key = `thread:${message.id}`
      thread = { kind: "thread", key, messages: [], slugs: [], expanded: options.expanded?.has(key) ?? false }
    }
    thread.messages.push(message)
    for (const slug of [message.botId!, to]) if (slug !== "all" && !thread.slugs.includes(slug)) thread.slugs.push(slug)
  }
  close()
  return out
}

const isFold = (e: Entry): e is Extract<Entry, { kind: "thread" | "background" }> =>
  e.kind === "thread" || e.kind === "background"

const entryTime = (e: Entry): number => (isFold(e) ? (e.messages.at(-1)?.sentAt ?? 0) : e.message.sentAt)

const entryId = (e: Entry): string => (isFold(e) ? e.key : e.message.id)

function foldItem(entry: Extract<Entry, { kind: "thread" | "background" }>): TimelineItem {
  if (entry.kind === "background") return { ...entry }
  return { kind: "thread", key: entry.key, messages: entry.messages, slugs: entry.slugs, expanded: entry.expanded }
}

export function buildTimelineItems(
  messages: readonly ChatMessage[],
  firstUnreadMessageId?: string | null,
  options: TimelineOptions = {},
): TimelineItem[] {
  const drawable = (m: ChatMessage) => !(options.members && addressee(m) !== undefined)
  const unreadIndex = messages.findIndex((m) => m.id === firstUnreadMessageId)
  if (unreadIndex >= 0 && !drawable(messages[unreadIndex])) {
    firstUnreadMessageId = messages.slice(unreadIndex + 1).find((m) => drawable(m) && m.sender !== "user")?.id
  }
  const list = entries(messages, options, folds(messages))
  const n = list.length
  if (n === 0) return []

  const continues = (i: number) => {
    const a = list[i - 1]
    const b = list[i]
    return (
      i > 0 &&
      a.kind === "message" &&
      b.kind === "message" &&
      a.inThread === b.inThread &&
      canGroup(a.message, b.message)
    )
  }
  const runStarts: number[] = Array.from({ length: n }, () => 0)
  for (let i = 0; i < n; i += 1) runStarts[i] = continues(i) ? runStarts[i - 1] : i
  const runEnds: number[] = Array.from({ length: n }, () => 0)
  for (let i = n - 1; i >= 0; i -= 1) {
    runEnds[i] = i + 1 < n && runStarts[i + 1] === runStarts[i] ? runEnds[i + 1] : i
  }

  const items: TimelineItem[] = []
  for (let i = 0; i < n; i += 1) {
    const entry = list[i]
    const at = entryTime(entry)
    const dayStart = dayStartOf(at)

    if (i > 0 && startsTimeBreak(entryTime(list[i - 1]), at)) {
      const newDay = dayStartOf(entryTime(list[i - 1])) !== dayStart
      const id = entryId(entry)
      items.push({
        kind: "day-divider",
        key: newDay ? `day:${dayStart}` : `gap:${id}`,
        dayStart,
        firstSentAt: at,
      })
    }
    if (entry.kind === "event") {
      items.push({ kind: "event", key: `event:${entry.message.id}`, message: entry.message })
      continue
    }
    if (isFold(entry)) {
      items.push(foldItem(entry))
      continue
    }
    const message = entry.message
    if (firstUnreadMessageId != null && message.id === firstUnreadMessageId && message.sender !== "user") {
      items.push({
        kind: "unread-divider",
        key: `unread:${message.id}`,
        afterMessageId: message.id,
      })
    }

    const runIndex = i - runStarts[i]
    const runSize = runEnds[i] - runStarts[i] + 1
    const isRunStart = runIndex === 0
    const start = list[runStarts[i]]
    items.push({
      kind: "message",
      key: `msg:${message.clientId ?? message.id}`,
      message,
      ...(entry.foldedRuns ? { foldedRuns: entry.foldedRuns } : {}),
      runKey: start.kind === "message" ? start.message.id : message.id,
      runIndex,
      runSize,
      isRunStart,
      isRunEnd: runIndex === runSize - 1,
      hasRunGapBefore: isRunStart,
    })
  }
  return items
}

const sameValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
}

function sameItem(a: TimelineItem, b: TimelineItem): boolean {
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  for (const k in x) if (!sameValue(x[k], y[k])) return false
  for (const k in y) if (!(k in x)) return false
  return true
}

type MessageItem = TimelineItem & { kind: "message" }
type Run = Pick<MessageItem, "runKey" | "runIndex" | "runSize" | "isRunStart" | "isRunEnd" | "hasRunGapBefore">

const runOf = (item: MessageItem): Run => ({
  runKey: item.runKey,
  runIndex: item.runIndex,
  runSize: item.runSize,
  isRunStart: item.isRunStart,
  isRunEnd: item.isRunEnd,
  hasRunGapBefore: item.hasRunGapBefore,
})

const sameRun = (a: Run, b: Run) =>
  a.runKey === b.runKey &&
  a.runIndex === b.runIndex &&
  a.runSize === b.runSize &&
  a.isRunStart === b.isRunStart &&
  a.isRunEnd === b.isRunEnd &&
  a.hasRunGapBefore === b.hasRunGapBefore

type Moves = { run: Setter<Run>; message: Setter<ChatMessage>; folded: Setter<readonly ChatMessage[] | undefined> }

const moves = new WeakMap<TimelineItem, Moves>()

function live(item: MessageItem): MessageItem {
  const [run, setRun] = createSignal(runOf(item), { equals: sameRun })
  const [message, setMessage] = createSignal(item.message)
  const [folded, setFolded] = createSignal(item.foldedRuns)
  const out: MessageItem = {
    kind: "message",
    key: item.key,
    get message() {
      return message()
    },
    get foldedRuns() {
      return folded()
    },
    get runKey() {
      return run().runKey
    },
    get runIndex() {
      return run().runIndex
    },
    get runSize() {
      return run().runSize
    },
    get isRunStart() {
      return run().isRunStart
    },
    get isRunEnd() {
      return run().isRunEnd
    },
    get hasRunGapBefore() {
      return run().hasRunGapBefore
    },
  }
  moves.set(out, { run: setRun, message: setMessage, folded: setFolded })
  return out
}

export function keepUnchanged(previous: Map<string, TimelineItem>, next: TimelineItem[]): TimelineItem[] {
  const out = next.map((item) => {
    const old = previous.get(item.key)
    if (old && sameItem(old, item)) return old
    if (item.kind !== "message") return item
    const movesFor = old?.kind === "message" && old.key === item.key ? moves.get(old) : undefined
    if (!movesFor) return live(item)
    movesFor.run(runOf(item))
    if ((old as MessageItem).message !== item.message) movesFor.message(item.message)
    if ((old as MessageItem).foldedRuns !== item.foldedRuns) movesFor.folded(item.foldedRuns)
    return old as MessageItem
  })
  previous.clear()
  for (const item of out) previous.set(item.key, item)
  return out
}
