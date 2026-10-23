import { dayStartOf } from "./day-start"

export const TIME_DIVIDER_GAP_MS = 20 * 60_000

export interface TimeLabelOptions {
  locale?: string
  timeZone?: string
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(options: Intl.DateTimeFormatOptions, opts: TimeLabelOptions): Intl.DateTimeFormat {
  const key = `${opts.locale ?? ""}|${opts.timeZone ?? ""}|${JSON.stringify(options)}`
  const cached = formatters.get(key)
  if (cached) return cached
  const created = new Intl.DateTimeFormat(opts.locale, { ...options, timeZone: opts.timeZone })
  formatters.set(key, created)
  return created
}

const fmt = (at: number, options: Intl.DateTimeFormatOptions, opts: TimeLabelOptions): string =>
  formatter(options, opts)
    .format(at)
    .replace(/[\u202f\u00a0]/g, " ")

const usable = (at: number): number => (Number.isFinite(at) ? at : Date.now())

export function startsTimeBreak(prev: number, at: number): boolean {
  if (!Number.isFinite(prev) || !Number.isFinite(at)) return false
  return dayStartOf(prev) !== dayStartOf(at) || at - prev > TIME_DIVIDER_GAP_MS
}

export function dividerParts(
  at: number,
  now: number,
  opts: TimeLabelOptions = {},
): { day: string; time: string; dated: boolean } {
  const nowAt = usable(now)
  const stamp = Number.isFinite(at) ? at : nowAt
  const time = fmt(stamp, { hour: "numeric", minute: "2-digit", hour12: true }, opts)
  const day = dayStartOf(stamp)
  const today = dayStartOf(nowAt)
  const t = new Date(today)
  const daysAgo = (n: number) => new Date(t.getFullYear(), t.getMonth(), t.getDate() - n).getTime()

  if (day === today) return { day: "Today", time, dated: false }
  if (day === daysAgo(1)) return { day: "Yesterday", time, dated: false }
  for (let n = 2; n <= 6; n += 1) {
    if (day === daysAgo(n)) return { day: fmt(stamp, { weekday: "long" }, opts), time, dated: false }
  }
  const sameYear = new Date(stamp).getFullYear() === t.getFullYear()
  if (sameYear) return { day: fmt(stamp, { month: "short", day: "numeric" }, opts), time, dated: true }
  return {
    day: fmt(stamp, { month: "short", day: "numeric", year: "numeric" }, opts).replace(/,/g, ""),
    time,
    dated: true,
  }
}

export function dividerLabel(at: number, now: number, opts: TimeLabelOptions = {}): string {
  const { day, time, dated } = dividerParts(at, now, opts)
  return dated ? `${day}, ${time}` : `${day} ${time}`
}

export function timeLabel(prev: number, at: number, now: number, opts: TimeLabelOptions = {}): string | undefined {
  return startsTimeBreak(prev, at) ? dividerLabel(at, now, opts) : undefined
}
