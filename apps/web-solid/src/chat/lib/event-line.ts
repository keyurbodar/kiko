import type { SystemEvent } from "@kiko/protocol"
import type { ChatMessage } from "../../lib/types"
import { providerMessage } from "./provider-message"

export type EventRow = {
  label: string
  detail?: string
  note?: string
  title?: string
  tone?: "muted" | "danger" | "warning"
}

type Loose = Record<string, unknown>
const text = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined)

function tokens(e: Loose): string | undefined {
  const before = typeof e.tokensBefore === "number" ? e.tokensBefore : undefined
  const after = typeof e.tokensAfter === "number" ? e.tokensAfter : undefined
  const fmt = (n: number) => n.toLocaleString("en-US")
  if (before !== undefined && after !== undefined) return `${fmt(before)} to ${fmt(after)} tokens`
  return before !== undefined ? `${fmt(before)} tokens` : undefined
}

export function eventRow(message: ChatMessage, name: (slug: string) => string): EventRow | null {
  const e = message.event as SystemEvent | undefined
  if (!e) return message.goto ? { label: message.body } : null
  const loose = e as unknown as Loose
  switch (e.kind) {
    case "created":
      return { label: `${e.title} is ready` }
    case "routine_created":
      return { label: e.byAgent ? `${name(e.agent)} created a routine` : "Routine added", detail: e.title }
    case "model_changed":
      return e.from
        ? { label: "Context handoff", detail: `${e.from} to ${e.model}` }
        : { label: `${name(e.agent)} switched to`, detail: e.model }
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
    case "run_stopped":
      return { label: "Stopped", detail: name(e.agent) }
    case "run_error": {
      const note = providerMessage(e.detail)
      const title = [message.body, e.detail].filter(Boolean).join("\n")
      return {
        label: `${name(e.slug)} could not answer`,
        tone: "danger",
        ...(message.body ? { detail: message.body } : {}),
        ...(note ? { note } : {}),
        ...(title ? { title } : {}),
      }
    }
    case "browser_control":
      return { label: message.body }
    case "agent_message":
      return { label: `${name(e.from)} messaged ${name(e.to)}` }
    default:
      return { label: text(loose.label) ?? (message.body || "Activity") }
  }
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
}

const messageCount = (n: number) => `${n} ${n === 1 ? "message" : "messages"}`

export function threadLabel(names: readonly string[], count: number): string {
  return count === 1 && names.length === 2
    ? `${names[0]} messaged ${names[1]}`
    : `${joinNames(names)} exchanged ${messageCount(count)}`
}
