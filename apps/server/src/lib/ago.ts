const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const minutes = (value: number) => `${value} minute${value === 1 ? "" : "s"}`
const hours = (value: number) => `${value} hour${value === 1 ? "" : "s"}`
const days = (value: number) => `${value} day${value === 1 ? "" : "s"}`

export function ago(ms: number): string {
  const since = Math.max(0, ms)
  if (since < 2_000) return "just now"
  if (since < MINUTE) return `${Math.round(since / 1_000)} seconds ago`
  if (since < HOUR) return `${minutes(Math.round(since / MINUTE))} ago`
  if (since < DAY) return `${hours(Math.round(since / HOUR))} ago`
  return `${days(Math.round(since / DAY))} ago`
}
