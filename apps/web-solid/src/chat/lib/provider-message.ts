const STATUS = /^\s*\d{3}\b[\s:.-]*/
const MAX = 240

function messageIn(value: unknown): string | undefined {
  if (typeof value === "string") return undefined
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  for (const key of ["error", "detail"]) {
    const inner = messageIn(record[key])
    if (inner) return inner
  }
  return typeof record.message === "string" && record.message.trim() ? record.message : undefined
}

function fromJson(text: string): string | undefined {
  const start = text.indexOf("{")
  if (start < 0) return undefined
  try {
    return messageIn(JSON.parse(text.slice(start)))
  } catch {
    return undefined
  }
}

function sentence(text: string): string {
  const words = text.replace(/\s+/g, " ").trim()
  const short = words.length > MAX ? `${words.slice(0, MAX - 1).trimEnd()}…` : words
  return /[.!?…]$/.test(short) ? short : `${short}.`
}

const RESETS = /^resets_at=(\S+)/
function clock(at: number, timeZone: string | undefined): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(at))
      .map((part) => [part.type, part.value]),
  )
}

function resetLine(at: number, now: number, timeZone: string | undefined): string {
  const then = clock(at, timeZone)
  const day = then.day === clock(now, timeZone).day && at - now < 86_400_000 ? "" : ` ${then.weekday}`
  return `Resets${day} at ${then.hour}:${then.minute}.`
}

export function providerMessage(detail: string | undefined, now = Date.now(), timeZone?: string): string | undefined {
  const text = detail?.trim()
  const reset = Date.parse(RESETS.exec(text ?? "")?.[1] ?? "")
  if (!Number.isNaN(reset)) return resetLine(reset, now, timeZone)
  if (!text || text.startsWith("<")) return undefined
  const found = fromJson(text) ?? (text.includes("{") ? undefined : text.replace(STATUS, ""))
  return found?.trim() ? sentence(found) : undefined
}
