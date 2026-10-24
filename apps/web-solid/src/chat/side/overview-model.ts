import type { Member } from "@kiko/protocol"

function since(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function liveLine(
  working: string | null,
  row: { lastFrom?: string; updatedAt: number } | undefined,
  now: number,
): string {
  if (working) return working
  if (!row?.lastFrom) return "No messages yet"
  return `${row.lastFrom === "agent" ? "Replied" : "Active"} ${since(now - row.updatedAt)}`
}

export const isGroup = (members: readonly Member[]): boolean => members.length > 1
