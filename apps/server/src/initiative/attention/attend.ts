import { type Appetite, allowance, kindOpen, restUntil } from "./appetite"
import type { RhythmView } from "./rhythm"
import type { Candidate, Level, Reason, Target, Verdict } from "./types"

export type AttendContext = {
  now: number
  level: Level
  away: boolean
  budget: number
  busyRooms: readonly string[]
  leads: Readonly<Record<string, string>>
  rhythm: RhythmView
  appetite: Appetite
  worthNow?: Readonly<Record<string, number>>
}

const WORTH = 0.5

export function score(c: Candidate, ctx: Pick<AttendContext, "now" | "rhythm">): number {
  const { now, rhythm } = ctx
  const cycle = rhythm.cycle
  let due = 0
  if (c.due !== undefined) {
    const deadline = c.due
    const ahead = rhythm.moments.length ? rhythm.moments.filter((m) => m < deadline).length : Math.floor(Math.max(0, deadline - now) / cycle)
    due = c.due <= now ? 1 : 1 / (1 + ahead)
  }
  const promise = c.owner !== "human" && (c.kind === "commitment" || c.kind === "task") && (c.due === undefined || c.due <= now + cycle) ? 1 : 0
  const parts: [number, number][] = [
    [1, due],
    [0.5, promise],
  ]
  return 1 - parts.reduce((p, [w, f]) => p * (1 - w * f), 1)
}

// Higher score first; among equal scores, the sighting that waited longest.
export function rankOrder(ctx: Pick<AttendContext, "now" | "rhythm">): (a: Candidate, b: Candidate) => number {
  return (a, b) => score(b, ctx) - score(a, ctx) || a.lastSeen - b.lastSeen
}

export function attend(candidates: readonly Candidate[], ctx: AttendContext): Verdict[] {
  const { now, rhythm, appetite } = ctx
  const out = new Map<string, Verdict>()
  const contenders: { c: Candidate; score: number; worth: number }[] = []
  const brief = (c: Candidate, s: number, reason: Reason) => out.set(c.id, { id: c.id, verdict: "brief", score: s, reason })

  for (const c of candidates) {
    const until = restUntil(c, rhythm.cycle)
    if (ctx.level !== "off" && now < until) {
      out.set(c.id, { id: c.id, verdict: "rest", until })
      continue
    }
    const s = score(c, ctx)
    const jev = ctx.worthNow ? (ctx.worthNow[c.id] ?? 0) : undefined
    if (ctx.level === "off") brief(c, s, "off")
    else if (ctx.level === "chat") brief(c, s, "quiet")
    else if (!rhythm.known) brief(c, s, "cold")
    else if (ctx.away) brief(c, s, "away")
    else if (ctx.busyRooms.includes(c.room)) brief(c, s, "typing")
    else if (now - c.lastSeen < rhythm.cycle / 2 && (c.due === undefined || c.due > now)) brief(c, s, "fresh")
    else if (c.certainty === "tentative" && jev === undefined) brief(c, s, "tentative")
    else if (jev === undefined && !kindOpen(appetite, c.kind, now)) brief(c, s, "appetite")
    else {
      const worth = jev ?? s
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
    const lead = ctx.leads[c.room]
    const target: Target | undefined = c.owner !== "human" ? { room: c.room, slug: c.owner } : lead ? { room: c.room, slug: lead } : undefined
    if (!target) brief(c, s, "no_lead")
    else if (taken.has(c.room)) brief(c, s, "room_taken")
    else if (taken.size >= cap) brief(c, s, taken.size >= ctx.budget && ctx.budget < appetiteCap ? "budget" : "allowance")
    else {
      taken.add(c.room)
      out.set(c.id, { id: c.id, verdict: "nudge", score: s, worth, target })
    }
  }
  return candidates.map((c) => {
    const verdict = out.get(c.id)
    if (!verdict) throw new Error(`attention produced no verdict for ${c.id}`)
    return verdict
  })
}
