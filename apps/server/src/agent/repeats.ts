import type { ConversationId } from "@earendil-works/pi-durable"
import type { Effect } from "@kiko/agent/effects"

const WINDOW = 8
const ALLOWED = 2
const CONVERSATIONS = 64

const REPEAT_REFUSAL = "you already made this exact call twice. change the approach or answer with what you have."

type Call = { id: string; name: string; arguments?: unknown }
type Seen = { run: string | null; calls: { id: string; key: string }[] }

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
      .join(",")}}`
  return JSON.stringify(value) ?? "null"
}

export class RepeatGuard {
  private readonly conversations = new Map<ConversationId, Seen>()

  constructor(private readonly runId: () => string | null = () => null) {}

  check(conversationId: ConversationId, call: Call, effect: Effect | undefined): string | undefined {
    const seen = this.seen(conversationId)
    if (seen.calls.some((c) => c.id === call.id)) return undefined
    const key = `${call.name} ${stable(call.arguments ?? {})}`
    if (seen.calls.filter((c) => c.key === key).length >= ALLOWED) return REPEAT_REFUSAL
    const kept = effect === "write" ? seen.calls.filter((c) => c.key === key) : seen.calls
    seen.calls = [...kept, { id: call.id, key }].slice(-WINDOW)
    return undefined
  }

  private seen(conversationId: ConversationId): Seen {
    const run = this.runId()
    const known = this.conversations.get(conversationId)
    this.conversations.delete(conversationId)
    const seen = known && known.run === run ? known : { run, calls: [] }
    this.conversations.set(conversationId, seen)
    for (const oldest of this.conversations.keys()) {
      if (this.conversations.size <= CONVERSATIONS) break
      this.conversations.delete(oldest)
    }
    return seen
  }
}
