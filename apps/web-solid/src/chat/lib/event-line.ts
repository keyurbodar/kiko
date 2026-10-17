import type { SystemEvent } from "@kiko/protocol"
import type { ChatMessage } from "../../lib/types"

export type EventRow = { label: string; detail?: string; title?: string; tone?: "muted" | "danger" | "warning" }

type Loose = Record<string, unknown>
const text = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined)

/** "Old to new", or the new model alone when the event does not say which one it replaced. */
function handoff(e: Loose): string | undefined {
  const from = text(e.from) ?? text(e.previous) ?? text(e.oldModel)
  const to = text(e.to) ?? text(e.model) ?? text(e.newModel)
  return from && to ? `${from} to ${to}` : to
}

/** "12,400 tokens before, 3,100 after" from whichever counts the event carries. */
function tokens(e: Loose): string | undefined {
  const before = typeof e.tokensBefore === "number" ? e.tokensBefore : undefined
  const after = typeof e.tokensAfter === "number" ? e.tokensAfter : undefined
  const fmt = (n: number) => n.toLocaleString("en-US")
  if (before !== undefined && after !== undefined) return `${fmt(before)} to ${fmt(after)} tokens`
  return before !== undefined ? `${fmt(before)} tokens` : undefined
}

const WORKER_ROW: Record<string, { label: string; tone?: "danger" }> = {
  started: { label: "started a task" },
  done: { label: "finished a task" },
  failed: { label: "could not finish a task", tone: "danger" },
  stopped: { label: "stopped a task" },
}

/** What a system event says as a divider row, or null for a kind this client does not draw. `name` turns a slug into the agent's name. */
export function eventRow(message: ChatMessage, name: (slug: string) => string): EventRow | null {
  const e = message.event as SystemEvent | undefined
  if (!e) return message.goto ? { label: message.body } : null
  const loose = e as unknown as Loose
  switch (e.kind) {
    case "created":
      return { label: `${e.title} is ready` }
    case "routine_created":
      return { label: e.byAgent ? `${name(e.agent)} created a routine` : "Routine added", detail: e.title }
    case "model_changed": {
      const detail = handoff(loose)
      return { label: "Context handoff", ...(detail ? { detail } : {}) }
    }
    case "compacted": {
      const detail = tokens(loose)
      return { label: "Context compacted", ...(detail ? { detail } : {}) }
    }
    case "group_formed":
      return { label: "Group formed" }
    case "member_added":
      return { label: `${e.name} joined` }
    case "member_removed":
      return { label: `${e.name} left` }
    case "delegated":
      return { label: `${name(e.from)} asked ${name(e.to)}`, detail: e.title }
    case "routine":
      return { label: e.title }
    case "worker": {
      const row = WORKER_ROW[e.state]
      return row ? { label: `${name(e.agent)} ${row.label}`, detail: e.title, ...(row.tone ? { tone: row.tone } : {}) } : null
    }
    case "run_stopped":
      return { label: "Stopped", detail: name(e.agent) }
    case "run_error": {
      const detail = message.body || undefined
      const title = [detail, e.detail].filter(Boolean).join("\n")
      return { label: `${name(e.slug)} could not answer`, tone: "danger", ...(detail ? { detail } : {}), ...(title ? { title } : {}) }
    }
    case "browser_control":
      return { label: message.body }
    case "agent_message":
      return { label: `${name(e.from)} messaged ${name(e.to)}` }
    default:
      return null
  }
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
}

const messageCount = (n: number) => `${n} ${n === 1 ? "message" : "messages"}`

/** "Kiko messaged Ada" for one message, "Kiko and Ada exchanged 3 messages" for more. */
export function threadLabel(names: readonly string[], count: number): string {
  return count === 1 && names.length === 2 ? `${names[0]} messaged ${names[1]}` : `${joinNames(names)} exchanged ${messageCount(count)}`
}
