import { type Member, roomIdTime } from "@kiko/protocol"

/** The moment a chat was made, read from the time part of its room id (a UUIDv7, or an older ULID). Null when the id is neither. */
export const startedAt = (roomId: string): number | null => roomIdTime(roomId)

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

/** `oct 2, 2026`, in lowercase and the reader's time zone. */
export function shortDate(at: number): string {
  const d = new Date(at)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

/** `started <date>`. A group's member count is the members section's title, not repeated here. */
export function subtitle(roomId: string, _members: readonly Member[]): string {
  const at = startedAt(roomId)
  return at === null ? "chat" : `started ${shortDate(at)}`
}

/** `12 b`, `3.4 kb`, `1.2 mb`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} b`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} kb`
  return `${(bytes / 1024 / 1024).toFixed(1)} mb`
}
