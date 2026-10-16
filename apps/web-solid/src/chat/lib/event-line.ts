import type { SystemEvent } from "@kiko/protocol"
import type { ChatMessage } from "../../lib/types"

/** What a system event says as one line, or null for a kind this client does not draw. `name` turns a slug into the agent's name. */
export function eventText(message: ChatMessage, name: (slug: string) => string): string | null {
  const e = message.event as SystemEvent | undefined
  if (!e) return message.goto ? message.body : null
  switch (e.kind) {
    case "created":
      return `${e.title} is ready`
    case "routine_created":
      return e.byAgent ? `${name(e.agent)} created a routine: ${e.title}` : `Routine added: ${e.title}`
    case "model_changed":
      return `${name(e.agent)} now uses ${e.model}`
    case "compacted":
      return `${name(e.agent)} compacted its context`
    case "group_formed":
      return "Group formed"
    case "member_added":
      return `${e.name} joined`
    case "member_removed":
      return `${e.name} left`
    case "delegated":
      return `${name(e.from)} asked ${name(e.to)} to ${e.title}`
    case "routine":
      return e.title
    case "run_error":
      return message.body
    case "agent_message":
      return `${name(e.from)} messaged ${name(e.to)}`
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
