import type { Trigger } from "@yuki/protocol"

// A chat's routines (architecture section 25), as the panel lists them: what starts each one,
// in words. Pure, so the table of cases is tested without a DOM.

const DAYS: Record<string, string> = { MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun" }

const clock = (at: number, timeZone?: string) =>
  new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone }).format(at).replace(/[  ]/g, " ")

const date = (at: number, timeZone?: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(at)

/** The parts of an RRULE the panel speaks: its frequency, interval, and weekdays. */
function readRule(rrule: string): { freq?: string; interval: number; days: string[] } {
  const parts = new Map(rrule.replace(/^RRULE:/i, "").split(";").map((p) => p.split("=") as [string, string]))
  const interval = Number(parts.get("INTERVAL") ?? 1)
  return {
    freq: parts.get("FREQ")?.toUpperCase(),
    interval: Number.isFinite(interval) && interval > 0 ? interval : 1,
    days: (parts.get("BYDAY") ?? "").split(",").map((d) => d.trim().slice(-2).toUpperCase()).filter((d) => d in DAYS),
  }
}

const UNITS: Record<string, string> = { HOURLY: "hour", DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" }

function timeLabel(trigger: Extract<Trigger, { on: "time" }>, timeZone?: string): string {
  const at = Date.parse(trigger.at)
  if (!Number.isFinite(at)) return "On a schedule"
  if (!trigger.rrule) return `Once, ${date(at, timeZone)} at ${clock(at, timeZone)}`
  const rule = readRule(trigger.rrule)
  const unit = rule.freq ? UNITS[rule.freq] : undefined
  if (!unit) return "Repeats"
  if (unit === "hour") return rule.interval === 1 ? "Every hour" : `Every ${rule.interval} hours`
  const when = `at ${clock(at, timeZone)}`
  if (unit === "week" && rule.days.length) {
    const weekdays = ["MO", "TU", "WE", "TH", "FR"]
    if (rule.days.length === 5 && weekdays.every((d) => rule.days.includes(d))) return `Weekdays ${when}`
    return `Every ${rule.days.map((d) => DAYS[d]).join(", ")} ${when}`
  }
  return `${rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`} ${when}`
}

/** What starts a routine, as a line under its name. */
export function triggerLabel(trigger: Trigger, timeZone?: string): string {
  switch (trigger.on) {
    case "time":
      return timeLabel(trigger, timeZone)
    case "task":
      return trigger.status?.length ? `When a task moves to ${trigger.status.join(" or ")}` : "When a task changes"
    case "message": {
      const who = trigger.from === "human" ? "When you send a message" : trigger.from === "agent" ? "When an agent posts" : "When a message arrives"
      return trigger.contains ? `${who} with “${trigger.contains}”` : who
    }
    case "file":
      return `When ${trigger.path} changes`
    case "webhook":
      return "When its webhook is called"
    case "watch": {
      let host = trigger.url
      try {
        host = new URL(trigger.url).host
      } catch {}
      return `When ${host} changes, checked every ${trigger.everyMinutes} min`
    }
  }
}
