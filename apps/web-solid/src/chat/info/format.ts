import { roomIdTime } from "@kiko/protocol"

/** The moment a chat was made, read from the time part of its room id (a UUIDv7, or an older ULID). Null when the id is neither. */
export const startedAt = (roomId: string): number | null => roomIdTime(roomId)

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** `Oct 2, 2026`, in the reader's time zone. */
export function shortDate(at: number): string {
  const d = new Date(at)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

/** `12 B`, `3.4 KB`, `1.2 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
