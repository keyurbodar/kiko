import { nextReset, utcDay } from "../room/limits"

export { nextReset, utcDay }

export type Limits = {
  plan: string
  turnsPerDay: number
  autonomousRunsPerDay: number
  awayDays: number
  storageBytes: number
  membersPerRoom: number
}

export const DEFAULT_LIMITS: Limits = {
  plan: "free",
  turnsPerDay: 500,
  autonomousRunsPerDay: 100,
  awayDays: 7,
  storageBytes: 1024 * 1024 * 1024,
  membersPerRoom: 8,
}

export function resolveLimits(stored: Partial<Limits> | null): Limits {
  const out = { ...DEFAULT_LIMITS }
  for (const [k, v] of Object.entries(stored ?? {})) {
    if (!(k in out)) continue
    if (k === "plan" ? typeof v === "string" : typeof v === "number" && Number.isFinite(v) && v >= 0) (out as Record<string, unknown>)[k] = v
  }
  return out
}

export type TurnAnswer = { ok: true; used: number } | { ok: false; limit: number; resetAt: number }

export function takeTurn(used: number, limits: Limits, now: number): TurnAnswer {
  if (used >= limits.turnsPerDay) return { ok: false, limit: limits.turnsPerDay, resetAt: nextReset(now) }
  return { ok: true, used: used + 1 }
}

export type AutonomousAnswer = { ok: true; used: number } | { ok: false; reason: "limit" | "away" }

export function takeAutonomous(used: number, lastSeen: number | null, limits: Limits, now: number): AutonomousAnswer {
  if (lastSeen !== null && now - lastSeen > limits.awayDays * 86_400_000) return { ok: false, reason: "away" }
  if (used >= limits.autonomousRunsPerDay) return { ok: false, reason: "limit" }
  return { ok: true, used: used + 1 }
}
