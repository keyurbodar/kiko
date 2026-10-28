const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

export function rowStamp(updatedAt: number, now: number): string {
  const delta = now - updatedAt
  if (delta < MINUTE) return "now"
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m`
  const at = new Date(updatedAt)
  if (sameDay(at, new Date(now)))
    return at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })
  if (delta < 7 * DAY) return at.toLocaleDateString(undefined, { weekday: "short" })
  return at.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
