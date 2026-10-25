const FRESH = Number.MAX_SAFE_INTEGER
const UNITS = [
  { unit: "year", ms: 365 * 86_400_000 },
  { unit: "month", ms: 30 * 86_400_000 },
  { unit: "day", ms: 86_400_000 },
  { unit: "hour", ms: 3_600_000 },
  { unit: "minute", ms: 60_000 },
] as const

export function editedText(at: number, now = Date.now()): string {
  if (at >= FRESH || now - at < 60_000) return "Just now"
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
  const unit = UNITS.find((u) => now - at >= u.ms) ?? UNITS[UNITS.length - 1]!
  return format.format(-Math.floor((now - at) / unit.ms), unit.unit)
}

const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })
const longDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" })

export function agoText(at: number, now = Date.now()): string {
  const gone = now - at
  if (at >= FRESH || gone < 60_000) return "Just now"
  if (gone < 3_600_000) return `${Math.floor(gone / 60_000)}m ago`
  if (gone < 86_400_000) return `${Math.floor(gone / 3_600_000)}h ago`
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear()
  return (sameYear ? shortDate : longDate).format(at)
}
