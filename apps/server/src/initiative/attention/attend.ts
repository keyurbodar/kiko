import { type Appetite, allowance, kindMean, kindOpen, restUntil } from "./appetite"
import type { RhythmView } from "./rhythm"
import type { Candidate, Level, Reason, Target, Verdict } from "./types"

export type AttendContext = {
  now: number
  level: Level
  /** The human is away (the seven-day rule). */
  away: boolean
  /** Proactive wakes left in the shared autonomous budget. */
  budget: number
  /** Rooms where the human wrote in the last moments. */
  busyRooms: readonly string[]
  /** The lead's slug per room. */
  leads: Readonly<Record<string, string>>
  rhythm: RhythmView
  appetite: Appetite
  /** Jev's "worth raising now?" probability per candidate id. Absent without Jev. */
  worthNow?: Readonly<Record<string, number>>
}

/** A nudge needs at least this worth: an even chance it is welcome. */
const WORTH = 0.5

/**
 * How pressing a candidate is, 0 to 1, before appetite. A noisy-or of independent reasons, so any
 * one strong reason is enough and several weak ones add up. Time is measured in the human's own
 * rhythm cycles, not in fixed hours.
 */
export function score(c: Candidate, ctx: Pick<AttendContext, "now" | "rhythm">): number {
  const { now, rhythm } = ctx
  const cycle = rhythm.cycle
  const age = Math.max(0, now - c.lastSeen) / cycle
  let due = 0
  if (c.due !== undefined) {
    const ahead = rhythm.moments.length ? rhythm.moments.filter((m) => m < c.due!).length : Math.floor(Math.max(0, c.due - now) / cycle)
    due = c.due <= now ? 1 : 1 / (1 + ahead)
  }
  // A promise with a date is kept near its date, not at the first moment after it was made.
  const promise = c.owner !== "human" && (c.kind === "commitment" || c.kind === "task") && (c.due === undefined || c.due <= now + cycle) ? 1 : 0
  const talked = (1 - 1 / (1 + c.mentions)) * 0.5 ** (age / 7)
  const stale = c.certainty === "explicit" && (c.kind === "goal" || c.kind === "project" || c.kind === "waiting") ? 1 - 0.5 ** (age / 7) : 0
  const parts: [number, number][] = [
    [1, due],
    [0.5, promise],
    [0.4, talked],
    [0.4, stale],
  ]
  return 1 - parts.reduce((p, [w, f]) => p * (1 - w * f), 1)
}

/**
 * Decide, for every candidate, what attention it gets in this pass. Safety gates come first and are
 * fixed: initiative off, an item at rest, the human away or busy in that room, the budget. Everything
 * else is learned: the moment from the rhythm, the appetite from past outcomes, and worth from Jev
 * when it is there; without Jev the score stands in for it. The most worthwhile items become nudges:
 * at most one per room, and no more than the appetite allows.
 */
export function attend(candidates: readonly Candidate[], ctx: AttendContext): Verdict[] {
  const { now, rhythm, appetite } = ctx
  const out = new Map<string, Verdict>()
  const contenders: { c: Candidate; score: number; worth: number }[] = []
  const brief = (c: Candidate, s: number, reason: Reason) => out.set(c.id, { id: c.id, verdict: "brief", score: s, reason })

  for (const c of candidates) {
    const until = restUntil(appetite, c, rhythm.cycle, now)
    if (ctx.level !== "off" && now < until) {
      out.set(c.id, { id: c.id, verdict: "rest", until })
      continue
    }
    const s = score(c, ctx)
    // With Jev, its answer gates: an item it did not read is not worth a wake this pass.
    const jev = ctx.worthNow ? (ctx.worthNow[c.id] ?? 0) : undefined
    if (ctx.level === "off") brief(c, s, "off")
    else if (ctx.level === "chat") brief(c, s, "quiet")
    else if (!rhythm.known) brief(c, s, "cold")
    else if (ctx.away) brief(c, s, "away")
    else if (ctx.busyRooms.includes(c.room)) brief(c, s, "typing")
    else if (now - c.lastSeen < rhythm.cycle / 2 && (c.due === undefined || c.due > now)) brief(c, s, "fresh")
    else if (c.certainty === "tentative" && jev === undefined) brief(c, s, "tentative")
    else if (!kindOpen(appetite, c.kind, now)) brief(c, s, "appetite")
    else {
      const worth = (jev ?? s) * Math.min(1, kindMean(appetite, c.kind, now) / 0.5)
      if (worth < WORTH) brief(c, s, "worth")
      else if (!rhythm.activeNow) brief(c, s, "moment")
      else contenders.push({ c, score: s, worth })
    }
  }

  const appetiteCap = allowance(appetite, now)
  const cap = Math.min(appetiteCap, ctx.budget, ctx.level === "digest" ? 1 : Number.POSITIVE_INFINITY)
  const taken = new Set<string>()
  contenders.sort((a, b) => b.worth - a.worth)
  for (const { c, score: s, worth } of contenders) {
    const target: Target | undefined = c.owner !== "human" ? { room: c.room, slug: c.owner } : ctx.leads[c.room] ? { room: c.room, slug: ctx.leads[c.room]! } : undefined
    if (!target) brief(c, s, "no_lead")
    else if (taken.has(c.room)) brief(c, s, "room_taken")
    else if (taken.size >= cap) brief(c, s, taken.size >= ctx.budget && ctx.budget < appetiteCap ? "budget" : "allowance")
    else {
      taken.add(c.room)
      out.set(c.id, { id: c.id, verdict: "nudge", score: s, worth, target })
    }
  }
  return candidates.map((c) => out.get(c.id)!)
}
