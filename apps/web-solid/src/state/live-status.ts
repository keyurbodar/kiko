import { type Activity, type AgentState, fileName } from "@kiko/protocol"

export type LiveStatus = { kind: "idle" | "thinking" | "tool"; text: string }

const IDLE: LiveStatus = { kind: "idle", text: "" }

const THINKING: LiveStatus = { kind: "thinking", text: "Thinking" }

const TOOL_TEXT = "Using a tool"

export const presenceWords = (presence: "typing" | "working") => (presence === "working" ? TOOL_TEXT : THINKING.text)

type Sent = { seq: number; from: { kind: string; slug?: string } }

export type LiveInput = {
  slug: string
  status: { state: AgentState; doing?: string; activity?: Activity } | undefined
  messages: readonly Sent[]
  mark: number | undefined
  running: boolean
  replied?: boolean
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

function plainDoing(doing: string): string {
  const words = doing
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => (word.includes("/") ? fileName(word.replace(/^\//, "")) : word))
  return capital(words.join(" "))
}

function newestHuman(messages: readonly Sent[]): number {
  return messages.findLast((m) => m.from.kind === "human")?.seq ?? 0
}

function repliedSince(input: LiveInput): boolean {
  if (input.replied !== undefined) return input.replied
  const mark = input.mark ?? newestHuman(input.messages)
  return input.messages.some((m) => m.seq > mark && m.from.kind === "agent" && m.from.slug === input.slug)
}

function backgroundText(activity: Extract<Activity, { kind: "background" }>): string {
  const count = activity.workers.length
  return count === 1 ? "Running 1 background task" : `Running ${count} background tasks`
}

function workingStatus(status: NonNullable<LiveInput["status"]>): LiveStatus {
  const activity = status.activity
  if (activity?.kind === "background") return { kind: "tool", text: backgroundText(activity) }
  const doing = activity?.kind === "tool" ? activity.caption : status.doing
  return doing ? { kind: "tool", text: plainDoing(doing) } : { kind: "tool", text: TOOL_TEXT }
}

export function liveStatusOf(input: LiveInput): LiveStatus {
  const status = input.status
  if (!status || status.state === "idle") return IDLE
  if (!input.running && repliedSince(input)) return IDLE
  if (status.state === "working") return workingStatus(status)
  return status.doing?.startsWith("retrying") ? { kind: "thinking", text: plainDoing(status.doing) } : THINKING
}

const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)

export function liveLine(live: readonly { name: string; status: LiveStatus }[], group: boolean): string | null {
  const [first, second] = live
  if (!first) return null
  if (!group) return first.status.text
  if (!second) return `${first.name} is ${lower(first.status.text)}`
  if (live.length === 2) return `${first.name} and ${second.name} are busy`
  return `${first.name} and ${live.length - 1} others are busy`
}

export const thinkingLine = (names: readonly string[], group: boolean): string =>
  liveLine(
    names.map((name) => ({ name, status: THINKING })),
    group,
  ) ?? THINKING.text

export type ChatTyping = { names: readonly string[]; since: number }

const NO_TYPING: Readonly<Record<string, ChatTyping>> = {}

export function typingOnStatus(
  typing: Readonly<Record<string, ChatTyping>>,
  status: "empty" | "cached" | "synchronizing" | "live" | "missing",
): Readonly<Record<string, ChatTyping>> {
  return status === "live" ? typing : NO_TYPING
}

type ChatTail = { roomId: string; last?: { from: string; at: number } }

export function otherChatTyping(
  typing: Readonly<Record<string, ChatTyping>>,
  chats: readonly ChatTail[],
): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = {}
  for (const chat of chats) {
    const entry = typing[chat.roomId]
    if (!entry) continue
    const last = chat.last
    if (last && last.from === "agent" && last.at > entry.since) continue
    out[chat.roomId] = entry.names
  }
  return out
}
