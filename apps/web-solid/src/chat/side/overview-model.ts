import { type FileRef, KIKO, type LifeLine, type Member } from "@kiko/protocol"
import type { BotPresence } from "../../lib/types"
import { typingLine } from "../../sidebar/activity"

export type Chip = { tone: "working" | "idle"; label: "Working" | "Idle" }

const WORKING: Chip = { tone: "working", label: "Working" }
const IDLE: Chip = { tone: "idle", label: "Idle" }

export function statusChip(presence: BotPresence | undefined): Chip {
  return presence === "typing" || presence === "working" ? WORKING : IDLE
}

export function since(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function liveLine(working: string | null, row: { lastFrom?: string; updatedAt: number } | undefined, now: number): string {
  if (working) return working
  if (!row?.lastFrom) return "No messages yet"
  return `${row.lastFrom === "agent" ? "Replied" : "Active"} ${since(now - row.updatedAt)}`
}

export function workingLine(agents: readonly { name: string; doing?: string }[], group: boolean): string | null {
  const [first] = agents
  if (!first) return null
  if (agents.length === 1 && first.doing) return `${first.name} is ${first.doing}`
  return typingLine(agents.map((a) => a.name), group)
}

export const isGroup = (members: readonly Member[]): boolean => members.length > 1

export type AgentRow = { slug: string; name: string; lead: boolean; chip: Chip; removable: boolean }

export function agentRows(members: readonly Member[], presence: (slug: string) => BotPresence | undefined): AgentRow[] {
  return members.map((m) => ({
    slug: m.slug,
    name: m.name,
    lead: m.lead,
    chip: statusChip(presence(m.slug)),
    removable: isGroup(members) && m.slug !== KIKO,
  }))
}

export function fileList(files: readonly FileRef[], n = 5): FileRef[] {
  return [...files].sort((a, b) => a.name.localeCompare(b.name)).slice(0, n)
}

export function memoryPick(lines: readonly LifeLine[], n = 3): LifeLine[] {
  return lines
    .filter((l) => !l.redacted && l.text.trim() !== "")
    .sort((a, b) => b.at - a.at)
    .slice(0, n)
}
