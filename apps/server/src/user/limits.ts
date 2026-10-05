// Architecture section 17.7, P9-01. A plan is one record. Every limit number lives here and in the
// stored record, nowhere else. `UserDO` keeps the record and counts turns per UTC day; the room asks
// before it delivers a human burst, and a refused burst starts no run.

export type Limits = {
  plan: string
  /** Human bursts answered per UTC day. */
  turnsPerDay: number
  /** Runs started without a human message (routines, reminders, task wakes, nudges) per UTC day, across chats. */
  autonomousRunsPerDay: number
  /** Days without opening kiko after which those runs are held (architecture section 25.5). */
  awayDays: number
  storageBytes: number
  membersPerRoom: number
  hops: number
  deliveriesPerRoot: number
}

/** ASSUMPTION: the free plan's numbers. */
export const DEFAULT_LIMITS: Limits = {
  plan: "free",
  turnsPerDay: 500,
  autonomousRunsPerDay: 100,
  awayDays: 7,
  storageBytes: 1024 * 1024 * 1024,
  membersPerRoom: 8,
  hops: 8,
  deliveriesPerRoot: 40,
}

/** `2026-10-02`, the UTC day a count belongs to. */
export const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10)

/** Epoch ms of the next UTC midnight, when the counts reset. */
export const nextReset = (now: number) => Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1)

/** The stored record over the defaults. Unknown keys and non-numbers are ignored. */
export function resolveLimits(stored: Partial<Limits> | null): Limits {
  const out = { ...DEFAULT_LIMITS }
  for (const [k, v] of Object.entries(stored ?? {})) {
    if (!(k in out)) continue
    if (k === "plan" ? typeof v === "string" : typeof v === "number" && Number.isFinite(v) && v >= 0) (out as Record<string, unknown>)[k] = v
  }
  return out
}

export type TurnAnswer = { ok: true; used: number } | { ok: false; limit: number; resetAt: number }

/** One more turn today, if the record allows it. Pure over the count, so a test drives it. */
export function takeTurn(used: number, limits: Limits, now: number): TurnAnswer {
  if (used >= limits.turnsPerDay) return { ok: false, limit: limits.turnsPerDay, resetAt: nextReset(now) }
  return { ok: true, used: used + 1 }
}

export type AutonomousAnswer = { ok: true; used: number } | { ok: false; reason: "limit" | "away" }

/** One more run without a human today (section 25.5). Pure over the count and the last time the human was seen. */
export function takeAutonomous(used: number, lastSeen: number | null, limits: Limits, now: number): AutonomousAnswer {
  if (lastSeen !== null && now - lastSeen > limits.awayDays * 86_400_000) return { ok: false, reason: "away" }
  if (used >= limits.autonomousRunsPerDay) return { ok: false, reason: "limit" }
  return { ok: true, used: used + 1 }
}
