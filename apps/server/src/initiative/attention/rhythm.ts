/**
 * The human's activity rhythm: when in the week they usually write. A decayed histogram of their
 * own message times by local weekday and hour, 168 numbers. It picks the moment to raise something
 * (the start of a usual active window) and how long a nudge may go unanswered before it counts as
 * ignored. Pure functions over a plain value; `AttentionStore` persists it.
 */

export type Rhythm = {
  /** Decayed message counts, index `weekday * 24 + hour` in local time, Monday = 0. */
  w: number[]
  /** Epoch ms the counts were last decayed to. */
  at: number
}

/** What `attend` needs from the rhythm at one instant. */
export type RhythmView = {
  /** Enough evidence to trust the windows. Without it nothing is nudged. */
  known: boolean
  /** Now falls inside one of the human's usual active windows. */
  activeNow: boolean
  /** The next starts of active windows, ascending, over the coming week. */
  moments: number[]
  /** Typical ms between two moments; one day when it cannot be read. */
  cycle: number
}

const SLOTS = 168
const HOUR = 3_600_000
const DAY = 24 * HOUR
const STEP = 15 * 60_000
/** Old habits fade: a message counts half after four weeks. */
const HALF_LIFE = 28 * DAY
/** Effective messages before the windows mean anything. */
const MIN_EVIDENCE = 10
/** Effective messages at which a weekday's own counts and the weekly average weigh the same. */
const POOL = 2
/** How far ahead moments and deadlines are searched. */
const HORIZON = 8 * DAY
const DEADLINE_HORIZON = 14 * DAY

export const emptyRhythm = (): Rhythm => ({ w: new Array(SLOTS).fill(0), at: 0 })

/** The counts as of `now`. A later message is never discounted by an earlier `now`. */
export function decayed(r: Rhythm, now: number): Rhythm {
  if (now <= r.at) return r
  const f = r.at === 0 ? 1 : 0.5 ** ((now - r.at) / HALF_LIFE)
  return { w: r.w.map((x) => x * f), at: now }
}

/** Add one human message at `at`. */
export function record(r: Rhythm, at: number, tz: string): Rhythm {
  const next = decayed(r, at)
  const w = next.w.slice()
  const late = at < next.at ? 0.5 ** ((next.at - at) / HALF_LIFE) : 1
  w[slotOf(at, tz)]! += late
  return { w, at: next.at }
}

const total = (r: Rhythm) => r.w.reduce((a, b) => a + b, 0)

/**
 * Expected messages per hour in a slot. A weekday's own counts are shrunk toward the same hour
 * across the week, strongly while evidence is thin and less as it grows, so early on a weekday
 * borrows from the others and later an empty weekday reads as empty. Neighbouring hours are
 * blended in so one stray message does not make a window.
 */
function rates(r: Rhythm): number[] {
  const hourAvg = Array.from({ length: 24 }, (_, h) => {
    let s = 0
    for (let d = 0; d < 7; d++) s += r.w[d * 24 + h]!
    return s / 7
  })
  const own = total(r) / (total(r) + POOL)
  const pooled = r.w.map((x, i) => own * x + (1 - own) * hourAvg[i % 24]!)
  return pooled.map((x, i) => 0.5 * x + 0.25 * pooled[(i + SLOTS - 1) % SLOTS]! + 0.25 * pooled[(i + 1) % SLOTS]!)
}

function activeSlots(r: Rhythm): boolean[] {
  const mean = total(r) / SLOTS
  return rates(r).map((x) => x > 0 && x >= mean)
}

export function known(r: Rhythm): boolean {
  return total(r) >= MIN_EVIDENCE
}

/** The window starts after `now`, at most `limit`, within the horizon. */
export function upcoming(r: Rhythm, now: number, tz: string, limit = 7): number[] {
  if (!known(r)) return []
  const active = activeSlots(r)
  const out: number[] = []
  let t = Math.floor(now / STEP) * STEP + STEP
  let prev = slotOf(t - STEP, tz)
  for (; t <= now + HORIZON && out.length < limit; t += STEP) {
    const s = slotOf(t, tz)
    if (s !== prev && active[s] && !active[prev]) out.push(t)
    prev = s
  }
  return out
}

/**
 * The next time the human is likely to start talking: the start of their next usual active
 * window. Null on a cold start; the caller then waits for the human's own next message and
 * surfaces things in the brief instead.
 */
export function nextMoment(r: Rhythm, now: number, tz: string): number | null {
  return upcoming(decayed(r, now), now, tz, 1)[0] ?? null
}

export function view(r: Rhythm, now: number, tz: string): RhythmView {
  const at = decayed(r, now)
  if (!known(at)) return { known: false, activeNow: false, moments: [], cycle: DAY }
  const moments = upcoming(at, now, tz)
  const cycle = moments.length > 1 ? (moments.at(-1)! - moments[0]!) / (moments.length - 1) : DAY
  return { known: true, activeNow: activeSlots(at)[slotOf(now, tz)]!, moments, cycle }
}

/**
 * When an unanswered nudge sent at `at` counts as ignored: once the human would usually have
 * written a typical day's worth of messages since. A daily writer gets about a day; someone who
 * writes only on weekends gets until the weekend has passed. One day on a cold start.
 */
export function ignoreDeadline(r: Rhythm, at: number, tz: string): number {
  const now = decayed(r, at)
  if (!known(now)) return at + DAY
  const rate = rates(now)
  const need = total(now) / 7
  let mass = 0
  for (let t = at; t < at + DEADLINE_HORIZON; t += STEP) {
    mass += (rate[slotOf(t, tz)]! * STEP) / HOUR
    if (mass >= need) return t + STEP
  }
  return at + DEADLINE_HORIZON
}

const WEEKDAY: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }
const formatters = new Map<string, Intl.DateTimeFormat>()

/** The local weekday-hour slot of an instant. */
export function slotOf(at: number, tz: string): number {
  let f = formatters.get(tz)
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" })
    } catch {
      // A zone stored before it was checked, or one this runtime does not know: read it as UTC.
      f = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", hour: "numeric", hourCycle: "h23" })
    }
    formatters.set(tz, f)
  }
  let day = 0
  let hour = 0
  for (const p of f.formatToParts(at)) {
    if (p.type === "weekday") day = WEEKDAY[p.value] ?? 0
    else if (p.type === "hour") hour = Number(p.value) % 24
  }
  return day * 24 + hour
}
