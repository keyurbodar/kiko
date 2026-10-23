import { dayStartOf } from "./day-start"

const MONTH_DAY = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })
const MONTH_DAY_YEAR = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" })
const MONTH_DAY_YEAR_SHORT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" })

const usable = (at: number): number => (Number.isFinite(at) ? at : Date.now())

export function dayChipLabel(dayStart: number, now: number): string {
  const target = dayStartOf(dayStart)
  const today = dayStartOf(usable(now))
  if (target === today) return "Today"

  const d = new Date(today)
  const yesterday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime()
  if (target === yesterday) return "Yesterday"

  const day = new Date(target)
  return (day.getFullYear() === d.getFullYear() ? MONTH_DAY : MONTH_DAY_YEAR_SHORT).format(day)
}

function formatTimeOfDay(sentAt: number): string {
  const d = new Date(usable(sentAt))
  const h24 = d.getHours()
  const hours = h24 % 12 === 0 ? 12 : h24 % 12
  const minutes = String(d.getMinutes()).padStart(2, "0")
  return `${hours}:${minutes} ${h24 < 12 ? "AM" : "PM"}`
}

export function formatFullTimestamp(sentAt: number): string {
  const stamp = usable(sentAt)
  const date = MONTH_DAY_YEAR.format(new Date(stamp))
  return `${date} at ${formatTimeOfDay(stamp)}`
}
