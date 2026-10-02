import type { Member } from "@kiko/protocol"

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

/** The moment a chat was made, read from the time part of its ULID room id. Null when the id is not one. */
export function startedAt(roomId: string): number | null {
  if (roomId.length < 10) return null
  let time = 0
  for (const char of roomId.slice(0, 10).toUpperCase()) {
    const digit = CROCKFORD.indexOf(char)
    if (digit < 0) return null
    time = time * 32 + digit
  }
  return time
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

/** `oct 2, 2026`, in lowercase and the reader's time zone. */
export function shortDate(at: number): string {
  const d = new Date(at)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

/** `started <date>` for a chat with one agent, `<n> members` for a group. The human counts as a member. */
export function subtitle(roomId: string, members: readonly Member[]): string {
  if (members.length > 1) return `${members.length + 1} members`
  const at = startedAt(roomId)
  return at === null ? "chat" : `started ${shortDate(at)}`
}

/** `12 b`, `3.4 kb`, `1.2 mb`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} b`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} kb`
  return `${(bytes / 1024 / 1024).toFixed(1)} mb`
}
