import type { Trigger } from "@kiko/protocol"

const DAYS: Record<string, string> = { MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun" }

const formats = new Map<string, Intl.DateTimeFormat>()

const formatter = (key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat => {
  const id = `${key}|${JSON.stringify(options)}`
  let found = formats.get(id)
  if (!found) formats.set(id, (found = new Intl.DateTimeFormat("en-US", options)))
  return found
}

const clock = (at: number, timeZone?: string) =>
  formatter("clock", { hour: "numeric", minute: "2-digit", hour12: true, timeZone }).format(at).replace(/\s/g, " ")

const date = (at: number, timeZone?: string) => formatter("date", { month: "short", day: "numeric", timeZone }).format(at)

function readRule(rrule: string) {
  const parts = new Map(rrule.replace(/^RRULE:/i, "").split(";").map((p) => p.split("=") as [string, string]))
  const interval = Number(parts.get("INTERVAL") ?? 1)
  const minute = Number(parts.get("BYMINUTE")?.split(",")[0] ?? 0)
  return {
    freq: parts.get("FREQ")?.toUpperCase(),
    interval: Number.isFinite(interval) && interval > 0 ? interval : 1,
    days: (parts.get("BYDAY") ?? "").split(",").map((d) => d.trim().slice(-2).toUpperCase()).filter((d) => d in DAYS),
    hours: (parts.get("BYHOUR") ?? "").split(",").filter(Boolean).map(Number).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23).sort((a, b) => a - b),
    minute: Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : 0,
  }
}

const UNITS: Record<string, string> = { HOURLY: "hour", DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" }

const hourLabel = (hour: number, minute: number, always: boolean) =>
  `${hour % 12 || 12}${always || minute ? `:${String(minute).padStart(2, "0")}` : ""} ${hour < 12 ? "AM" : "PM"}`

function timeLabel(trigger: Extract<Trigger, { on: "time" }>, timeZone?: string): string {
  const at = Date.parse(trigger.at)
  if (!Number.isFinite(at)) return "On a schedule"
  if (!trigger.rrule) return `Once, ${date(at, timeZone)} at ${clock(at, timeZone)}`
  const rule = readRule(trigger.rrule)
  const unit = rule.freq ? UNITS[rule.freq] : undefined
  if (!unit) return "Repeats"
  if (unit === "hour") return rule.interval === 1 ? "Every hour" : `Every ${rule.interval} hours`
  const step = rule.hours[1] - rule.hours[0]
  const evenlySpaced = rule.hours.length >= 3 && step > 0 && rule.hours.every((h, i) => i === 0 || h - rule.hours[i - 1] === step)
  if (unit === "day" && rule.interval === 1 && evenlySpaced) {
    const every = step === 1 ? "Every hour" : `Every ${step} hours`
    return `${every}, ${hourLabel(rule.hours[0], rule.minute, false)} to ${hourLabel(rule.hours[rule.hours.length - 1], rule.minute, false)}`
  }
  const times = rule.hours.map((h) => hourLabel(h, rule.minute, rule.hours.length === 1))
  const when = `at ${times.length ? times.join(", ") : clock(at, timeZone)}`
  if (unit === "week" && rule.days.length) {
    const weekdays = ["MO", "TU", "WE", "TH", "FR"]
    if (rule.days.length === 5 && weekdays.every((d) => rule.days.includes(d))) return `Weekdays ${when}`
    return `Every ${rule.days.map((d) => DAYS[d]).join(", ")} ${when}`
  }
  return `${rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`} ${when}`
}

export function triggerLabel(trigger: Trigger, timeZone?: string): string {
  switch (trigger.on) {
    case "time":
      return timeLabel(trigger, timeZone)
    case "message": {
      const who = "When you send a message"
      return trigger.contains ? `${who} with “${trigger.contains}”` : who
    }
    case "webhook":
      return "When its webhook is called"
    default:
      return "Trigger no longer supported"
  }
}
