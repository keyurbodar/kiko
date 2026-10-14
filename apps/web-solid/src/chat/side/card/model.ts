import { type FileRef, KIKO, type LifeLine, type Member } from "@kiko/protocol"
import type { BotPresence } from "../../../lib/types"
import { typingLine } from "../../../sidebar/activity"
import type { PlateLoop } from "../../info/loops"
import type { Routine } from "../../info/routines"

/*
 * The chat card's rules, as pure functions: which rows appear, what each chip says, which files and
 * memory lines show. The card draws what these return and holds no logic of its own.
 */

export type Chip = { tone: "working" | "idle"; label: "Working" | "Idle" }

const WORKING: Chip = { tone: "working", label: "Working" }
const IDLE: Chip = { tone: "idle", label: "Idle" }

/** Typing and working read as "Working". Idle and sleeping read as "Idle". */
export function statusChip(presence: BotPresence | undefined): Chip {
  return presence === "typing" || presence === "working" ? WORKING : IDLE
}

/** `just now`, `2m ago`, `3h ago`, `4d ago`. */
export function since(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/** The line under the chat's name: what the agents are doing, else when the chat last moved, else "Idle". */
export function liveLine(working: string | null, updatedAt: number | undefined, now: number): string {
  if (working) return working
  if (updatedAt === undefined) return "Idle"
  return `Replied ${since(now - updatedAt)}`
}

/** What the agents typing now are doing, in words, or null when none is. One agent with a doing reads as "Name is doing". */
export function workingLine(agents: readonly { name: string; doing?: string }[], group: boolean): string | null {
  const [first] = agents
  if (!first) return null
  if (agents.length === 1 && first.doing) return `${first.name} is ${first.doing}`
  return typingLine(agents.map((a) => a.name), group)
}

/** A group is a room with more than one agent. Only a group shows the Agents section. */
export const isGroup = (members: readonly Member[]): boolean => members.length > 1

export type AgentRow = { slug: string; name: string; lead: boolean; chip: Chip; removable: boolean }

/** Each agent in the room's order. An agent can leave only a group, and Kiko never leaves. */
export function agentRows(members: readonly Member[], presence: (slug: string) => BotPresence | undefined): AgentRow[] {
  return members.map((m) => ({
    slug: m.slug,
    name: m.name,
    lead: m.lead,
    chip: statusChip(presence(m.slug)),
    removable: isGroup(members) && m.slug !== KIKO,
  }))
}

/** Active routines first, then paused ones, each in the order the list gives. Open plate items keep their order. */
export function comingUp(routines: readonly Routine[], loops: readonly PlateLoop[]): { routines: Routine[]; loops: PlateLoop[] } {
  return {
    routines: [...routines.filter((r) => r.status === "active"), ...routines.filter((r) => r.status === "paused")],
    loops: [...loops],
  }
}

/**
 * The room sends no modified time, and its list is by path on load but appends live files, so the
 * card cannot tell which file changed last. It shows the first few by name, which is stable.
 */
export function fileList(files: readonly FileRef[], n = 5): FileRef[] {
  return [...files].sort((a, b) => a.name.localeCompare(b.name)).slice(0, n)
}

/** The newest lines that are not removed, newest first. */
export function memoryPick(lines: readonly LifeLine[], n = 3): LifeLine[] {
  return lines
    .filter((l) => !l.redacted && l.text.trim() !== "")
    .sort((a, b) => b.at - a.at)
    .slice(0, n)
}
