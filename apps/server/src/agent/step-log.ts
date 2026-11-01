import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { Conversation, ConversationId, Harness } from "@earendil-works/pi-durable"
import { noteOf } from "./pacing"
import { type Describe, outputOf, type StepItem, type StepScope, stepOf, type StepShown } from "./extensions/presence"

type Part = { type?: string; text?: string; id?: string; name?: string; arguments?: unknown }
type Message = {
  role?: string
  content?: string | readonly Part[]
  timestamp?: number
  durationMs?: number
  toolCallId?: string
  isError?: boolean
}
type Entry = { id: number; conversationId?: ConversationId; kind?: string; model?: readonly unknown[] }

type Opened = { id: string; name: string; scope: StepScope; shown: StepShown }

const partsOf = (message: Message): readonly Part[] =>
  typeof message.content === "string" ? [] : (message.content ?? [])

const textOf = (parts: readonly Part[]) =>
  parts.flatMap((part) => (part.type === "text" && part.text ? [part.text] : [])).join("")

function note(entry: Entry, message: Message, scope: StepScope, parts: readonly Part[]): StepItem | null {
  const text = textOf(parts)
  if (!text.trim()) return null
  const at = message.timestamp ?? 0
  return {
    step: {
      id: `note:${entry.id}`,
      runId: scope.runId,
      ...(scope.worker ? { worker: scope.worker } : {}),
      tool: "other",
      name: "note",
      note: true,
      label: noteOf(text),
      status: "done",
      startedAt: at,
      endedAt: at,
    },
  }
}

function result(entry: Entry, message: Message, call: Opened, parts: readonly Part[]): StepItem | null {
  const endedAt = message.timestamp ?? 0
  const startedAt = Math.max(0, endedAt - (message.durationMs ?? 0))
  const output = outputOf(parts)
  return {
    step: {
      id: call.id,
      runId: call.scope.runId,
      ...(call.scope.worker ? { worker: call.scope.worker } : {}),
      ...call.shown,
      status: message.isError ? "failed" : "done",
      startedAt,
      endedAt,
      ...(output ? { output } : {}),
    },
  }
}

export function stepsFromEntries(
  entries: readonly Entry[],
  after: number,
  scope: (conversationId: ConversationId) => StepScope | null,
  describe?: Describe,
): StepItem[] {
  const items: StepItem[] = []
  const calls = new Map<string, Opened>()
  for (const entry of entries) {
    if (entry.id <= after) continue
    if (entry.kind === "kiko.input" || entry.kind === "pi.user") break
    const conversationId = entry.conversationId
    const message = entry.model?.[0] as Message | undefined
    if (conversationId === undefined || !message) continue
    const scoped = scope(conversationId)
    if (!scoped) continue
    const parts = partsOf(message)
    if (message.role === "assistant") {
      const toolCalls = parts.filter((part) => part.type === "toolCall" && typeof part.id === "string")
      if (!toolCalls.length) continue
      const item = note(entry, message, scoped, parts)
      if (item) items.push(item)
      for (const part of toolCalls) {
        if (typeof part.name !== "string" || part.id === undefined) continue
        const shown = stepOf(part.name, (part.arguments ?? {}) as Record<string, unknown>, describe)
        if (!shown) continue
        calls.set(`${conversationId}:${part.id}`, { id: part.id, name: part.name, scope: scoped, shown })
      }
    } else if (message.role === "toolResult" && message.toolCallId !== undefined) {
      const call = calls.get(`${conversationId}:${message.toolCallId}`)
      if (!call) continue
      const item = result(entry, message, call, parts)
      if (item) items.push(item)
    }
  }
  return items
}

export async function resumedSteps(
  harness: Harness,
  root: Conversation,
  live: { input: number },
  workers: readonly { conversationId: ConversationId | null }[],
  scope: (conversationId: ConversationId) => StepScope | null,
  describe?: Describe,
): Promise<StepItem[]> {
  const walk = async (conversation: Conversation, after: number) => {
    const view = await conversation.context(BACKGROUND_CONTEXT)
    return stepsFromEntries(view.entries, after, scope, describe)
  }
  const items = await walk(root, live.input)
  for (const work of workers) {
    if (work.conversationId === null) continue
    const conversation = await harness.conversation(work.conversationId, BACKGROUND_CONTEXT)
    if (conversation) items.push(...(await walk(conversation, 0)))
  }
  return items
}
