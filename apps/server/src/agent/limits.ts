export type Limit = { scope: "account" | "model" | "request"; resetAt?: number; long?: true }

type LimitInput = {
  status?: number
  headers?: Headers | Record<string, string>
  message?: string
  now: number
}

type Fields = Record<string, string>

const UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  sec: 1000,
  secs: 1000,
  second: 1000,
  seconds: 1000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
}

const MODEL_CLAIM = /opus|sonnet|haiku/i
const USAGE = /usage[ _-]?limit|session limit|usage_limit_reached/i
const LONG_WINDOW = /weekly|per[_ -]?week|monthly|per[_ -]?month|daily|per[_ -]?day|seven_day|7[- ]day/i
const CODEX_LONG_MINUTES = 300

function durationMs(text: string): number | undefined {
  let total = 0
  let found = false
  for (const part of text.matchAll(/(\d+(?:\.\d+)?)\s*(ms|[a-z]+)/gi)) {
    const unit = UNITS[(part[2] ?? "").toLowerCase()]
    if (unit === undefined) return undefined
    total += Number(part[1]) * unit
    found = true
  }
  return found ? Math.round(total) : undefined
}

function moment(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined
  const number = Number(value)
  if (Number.isFinite(number)) return number < 1e11 ? number * 1000 : number
  if (!/(?:Z|[+-]\d{2}:?\d{2}|\bUTC|\bGMT)$/i.test(value)) return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

function retryAfter(headers: Fields, now: number): number | undefined {
  const ms = headers["retry-after-ms"]
  if (ms !== undefined && ms !== "" && Number.isFinite(Number(ms))) return now + Number(ms)
  const value = headers["retry-after"]
  if (value === undefined || value === "") return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return now + seconds * 1000
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : date
}

const withReset = (limit: Limit, resetAt: number | undefined): Limit =>
  resetAt === undefined ? limit : { ...limit, resetAt }

function claude(headers: Fields, now: number): Limit | null {
  const claim = headers["anthropic-ratelimit-unified-representative-claim"] ?? ""
  const scope = MODEL_CLAIM.test(claim) ? "model" : "account"
  const week = headers["anthropic-ratelimit-unified-7d-status"] === "rejected"
  const hours5 = headers["anthropic-ratelimit-unified-5h-status"] === "rejected"
  const overall = headers["anthropic-ratelimit-unified-reset"]
  if (week || hours5) {
    const named = moment(headers[`anthropic-ratelimit-unified-${week ? "7d" : "5h"}-reset`])
    const reset = named ?? moment(overall) ?? retryAfter(headers, now)
    return withReset({ scope, ...(week ? { long: true as const } : {}) }, reset)
  }
  const status = headers["anthropic-ratelimit-unified-status"]
  if (status === undefined && overall === undefined) return null
  if (status !== undefined && status !== "rejected") return null
  return withReset({ scope }, moment(overall) ?? retryAfter(headers, now))
}

function codex(headers: Fields, now: number): Limit | null {
  const resets: number[] = []
  let full = false
  let long = false
  for (const window of ["primary", "secondary"]) {
    if (!(Number(headers[`x-codex-${window}-used-percent`]) >= 100)) continue
    full = true
    long ||= Number(headers[`x-codex-${window}-window-minutes`]) > CODEX_LONG_MINUTES
    const after = Number(headers[`x-codex-${window}-reset-after-seconds`])
    const at =
      moment(headers[`x-codex-${window}-reset-at`]) ?? (Number.isFinite(after) ? now + after * 1000 : undefined)
    if (at !== undefined) resets.push(at)
  }
  if (!full) return null
  const reset = resets.length ? Math.max(...resets) : retryAfter(headers, now)
  return withReset({ scope: "account", ...(long ? { long: true as const } : {}) }, reset)
}

function windows(headers: Fields, now: number): number | undefined {
  const resets: { at: number; empty: boolean }[] = []
  for (const [name, value] of Object.entries(headers)) {
    const open = /^x-ratelimit-reset-(.+)$/.exec(name)
    const dated = /^anthropic-ratelimit-(?!unified)(.+)-reset$/.exec(name)
    const what = open?.[1] ?? dated?.[1]
    if (what === undefined) continue
    const at = open ? (durationMs(value) ?? Number.NaN) + now : moment(value)
    const remaining = headers[`x-ratelimit-remaining-${what}`] ?? headers[`anthropic-ratelimit-${what}-remaining`]
    if (at !== undefined && Number.isFinite(at))
      resets.push({ at, empty: remaining !== undefined && Number(remaining) <= 0 })
  }
  const empty = resets.filter((r) => r.empty).map((r) => r.at)
  if (empty.length) return Math.max(...empty)
  return resets.length ? Math.min(...resets.map((r) => r.at)) : undefined
}

function fromHeaders(headers: Fields, status: number | undefined, now: number): Limit | null {
  const named = claude(headers, now) ?? codex(headers, now)
  if (named) return named
  const wait = retryAfter(headers, now)
  if (status !== 429) return wait === undefined ? null : { scope: "request", resetAt: wait }
  return withReset({ scope: "request" }, wait ?? windows(headers, now))
}

const AGAIN = [
  /(?:retry[ _]?delay|quotaResetDelay)"?\s*[:=]?\s*"?((?:\d+(?:\.\d+)?\s*[a-z]+\s*)+)/i,
  /(?:try|retry)(?:ing)?(?: your request)?(?: again)? (?:in|after)\s*~?\s*((?:\d+(?:\.\d+)?\s*[a-z]+\s*)+)/i,
  /resets? (?:in|after)\s*~?\s*((?:\d+(?:\.\d+)?\s*[a-z]+\s*)+)/i,
]

function fromText(message: string, now: number): number | undefined {
  const seconds = /"?resets_in_seconds"?\s*[:=]\s*(\d+(?:\.\d+)?)/i.exec(message)
  if (seconds) return now + Number(seconds[1]) * 1000
  const at = /"?resets_at"?\s*[:=]\s*"?([0-9][0-9T:.+-]*Z?)/i.exec(message)
  const stamped = moment(at?.[1])
  if (stamped !== undefined) return stamped
  for (const pattern of AGAIN) {
    const delay = durationMs(pattern.exec(message)?.[1] ?? "")
    if (delay !== undefined) return now + delay
  }
  const dated = /resets? (?:at|on)\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))/i.exec(
    message,
  )
  return moment(dated?.[1])
}

function lowered(headers: LimitInput["headers"]): Fields {
  const out: Fields = {}
  if (!headers) return out
  const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers)
  for (const [name, value] of entries) out[name.toLowerCase()] = value
  return out
}

export function limitOf(input: LimitInput): Limit | null {
  const headed = fromHeaders(lowered(input.headers), input.status, input.now)
  if (headed?.resetAt !== undefined) return headed
  const message = input.message ?? ""
  const resetAt = message ? fromText(message, input.now) : undefined
  if (resetAt === undefined) return headed
  return {
    scope: USAGE.test(message) ? "account" : "request",
    resetAt,
    ...(LONG_WINDOW.test(message) ? { long: true as const } : {}),
  }
}
