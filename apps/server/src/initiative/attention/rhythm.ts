export type Rhythm = {
  w: number[]
  at: number
}

export type RhythmView = {
  known: boolean
  activeNow: boolean
  moments: number[]
  cycle: number
}

const SLOTS = 168
const HOUR = 3_600_000
const DAY = 24 * HOUR
const STEP = 15 * 60_000
const HALF_LIFE = 28 * DAY
const MIN_EVIDENCE = 10
const POOL = 2
const HORIZON = 8 * DAY
const DEADLINE_HORIZON = 14 * DAY

export const emptyRhythm = (): Rhythm => ({ w: new Array(SLOTS).fill(0), at: 0 })

export function decayed(r: Rhythm, now: number): Rhythm {
  if (now <= r.at) return r
  const f = r.at === 0 ? 1 : 0.5 ** ((now - r.at) / HALF_LIFE)
  return { w: r.w.map((x) => x * f), at: now }
}

export function record(r: Rhythm, at: number, tz: string): Rhythm {
  const next = decayed(r, at)
  const w = next.w.slice()
  const late = at < next.at ? 0.5 ** ((next.at - at) / HALF_LIFE) : 1
  const slot = slotOf(at, tz)
  w[slot] = (w[slot] ?? 0) + late
  return { w, at: next.at }
}

const total = (r: Rhythm) => r.w.reduce((a, b) => a + b, 0)

function rates(r: Rhythm): number[] {
  const hourAvg = Array.from({ length: 24 }, (_, h) => {
    let s = 0
    for (let d = 0; d < 7; d++) s += r.w[d * 24 + h] ?? 0
    return s / 7
  })
  const own = total(r) / (total(r) + POOL)
  const pooled = r.w.map((x, i) => own * x + (1 - own) * (hourAvg[i % 24] ?? 0))
  return pooled.map((x, i) => 0.5 * x + 0.25 * (pooled[(i + SLOTS - 1) % SLOTS] ?? 0) + 0.25 * (pooled[(i + 1) % SLOTS] ?? 0))
}

function activeSlots(r: Rhythm): boolean[] {
  const mean = total(r) / SLOTS
  return rates(r).map((x) => x > 0 && x >= mean)
}

export function known(r: Rhythm): boolean {
  return total(r) >= MIN_EVIDENCE
}

function upcoming(r: Rhythm, now: number, tz: string, limit = 7): number[] {
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

export function nextMoment(r: Rhythm, now: number, tz: string): number | null {
  return upcoming(decayed(r, now), now, tz, 1)[0] ?? null
}

export function view(r: Rhythm, now: number, tz: string): RhythmView {
  const at = decayed(r, now)
  if (!known(at)) return { known: false, activeNow: false, moments: [], cycle: DAY }
  const moments = upcoming(at, now, tz)
  const cycle = moments.length > 1 ? ((moments.at(-1) ?? 0) - (moments[0] ?? 0)) / (moments.length - 1) : DAY
  return { known: true, activeNow: activeSlots(at)[slotOf(now, tz)] ?? false, moments, cycle }
}

export function ignoreDeadline(r: Rhythm, at: number, tz: string): number {
  const now = decayed(r, at)
  if (!known(now)) return at + DAY
  const rate = rates(now)
  const need = total(now) / 7
  let mass = 0
  for (let t = at; t < at + DEADLINE_HORIZON; t += STEP) {
    mass += ((rate[slotOf(t, tz)] ?? 0) * STEP) / HOUR
    if (mass >= need) return t + STEP
  }
  return at + DEADLINE_HORIZON
}

const WEEKDAY: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }
const formatters = new Map<string, Intl.DateTimeFormat>()

export function slotOf(at: number, tz: string): number {
  let f = formatters.get(tz)
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" })
    } catch {
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
