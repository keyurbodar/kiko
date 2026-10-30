import { type HumanAsk, humanQuestions } from "@kiko/protocol"
import type { ChatMessage } from "../lib/types"

export type Need = {
  kind: "ask" | "failed"
  text: string
  retry?: () => void
}

export type Failures = ReadonlyMap<string, string>

export const loadedFor = (messages: readonly ChatMessage[], activeId: string | null): boolean =>
  activeId !== null && messages.at(-1)?.threadId === activeId

export const failureOf = (messages: readonly ChatMessage[], retry: (id: string) => void): Need | undefined => {
  const last = messages.at(-1)
  const event = last?.event
  if (!last || event?.kind !== "run_error" || !("actions" in event)) return undefined
  const canRetry = event.actions.includes("retry")
  return { kind: "failed", text: last.body, ...(canRetry ? { retry: () => retry(last.id) } : {}) }
}

const askOf = (asks: readonly HumanAsk[]): Need | undefined => {
  const ask = asks[0]
  if (!ask) return undefined
  const text = humanQuestions(ask)[0]?.question ?? ask.text
  return { kind: "ask", text }
}

export function needsOf(input: {
  activeId: string | null
  asks: readonly HumanAsk[]
  messages: readonly ChatMessage[]
  retry: (messageId: string) => void
  known: Failures
}): ReadonlyMap<string, Need> {
  const out = new Map<string, Need>()
  for (const [id, text] of input.known) out.set(id, { kind: "failed", text })
  if (input.activeId === null) return out
  const loaded = loadedFor(input.messages, input.activeId)
  const own = askOf(input.asks) ?? (loaded ? failureOf(input.messages, input.retry) : undefined)
  if (own) out.set(input.activeId, own)
  else if (loaded) out.delete(input.activeId)
  return out
}
