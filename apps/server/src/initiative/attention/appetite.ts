import type { Kind, Signal } from "./types"

/**
 * How much the human wants to be nudged, learned from what happened after past nudges. Each
 * estimate is a Beta posterior over "the human engages with a nudge": a neutral Beta(1, 1) prior
 * plus outcome counts that fade with time, so an old run of ignores stops counting and the agent
 * tries again, carefully. One estimate for the user, one per kind.
 *
 * A gate reads the posterior's mean plus one standard deviation. Little evidence leaves room to
 * try; repeated ignores close it; time reopens it as the counts fade.
 */

export type Counts = { a: number; b: number; at: number }

/** A nudge waiting for its outcome. `deadline` comes from `ignoreDeadline` when it was sent. */
export type Pending = { id: string; room: string; kind: Kind; loop: string; at: number; deadline: number }

export type Appetite = { user: Counts; kinds: Partial<Record<Kind, Counts>>; pending: Pending[] }

export type Result = "engaged" | "ignored" | "dismissed"
export type Outcome = { nudge: Pending; result: Result; at: number }

const DAY = 86_400_000
/** An outcome counts half after two weeks. */
const HALF_LIFE = 14 * DAY
/** A dismissal weighs as much as this many ignores for its kind. */
const DISMISS_WEIGHT = 5
/** The most nudges one pass may allow, however keen the human is. */
const MAX_PER_PASS = 3
const GATE = 0.5

export const emptyAppetite = (): Appetite => ({ user: { a: 0, b: 0, at: 0 }, kinds: {}, pending: [] })

function fade(c: Counts, now: number): Counts {
  if (now <= c.at) return c
  const f = c.at === 0 ? 1 : 0.5 ** ((now - c.at) / HALF_LIFE)
  return { a: c.a * f, b: c.b * f, at: now }
}

function add(c: Counts | undefined, now: number, a: number, b: number): Counts {
  const f = fade(c ?? { a: 0, b: 0, at: now }, now)
  return { a: f.a + a, b: f.b + b, at: f.at }
}

/** Posterior mean and standard deviation with the Beta(1, 1) prior. */
function posterior(c: Counts | undefined, now: number): { mean: number; sd: number } {
  const f = c ? fade(c, now) : { a: 0, b: 0 }
  const a = f.a + 1
  const b = f.b + 1
  const n = a + b
  return { mean: a / n, sd: Math.sqrt((a * b) / (n * n * (n + 1))) }
}

/** The chance the human engages with a nudge of this kind. 0.5 with no evidence. */
export function kindMean(app: Appetite, kind: Kind, now: number): number {
  return posterior(app.kinds[kind], now).mean
}

/** Whether a nudge of this kind may be tried at all. */
export function kindOpen(app: Appetite, kind: Kind, now: number): boolean {
  const p = posterior(app.kinds[kind], now)
  return p.mean + p.sd > GATE
}

/**
 * How many nudges this pass may send. The first needs the optimistic estimate (mean plus one
 * deviation) to clear the gate, the second the pessimistic one (mean minus one), the third mean
 * minus three. A new user gets one; two ignores in a row give zero; a human who keeps answering
 * earns more.
 */
export function allowance(app: Appetite, now: number): number {
  const p = posterior(app.user, now)
  let n = 0
  while (n < MAX_PER_PASS && p.mean + p.sd * (1 - 2 * n) > GATE) n++
  return n
}

/**
 * When a loop that was nudged before may come up again. One rhythm cycle for a loop never ignored
 * of a kind the human answers half the time; it doubles with each ignore of this loop and stretches
 * as the kind's engagement falls. Zero for a loop never nudged.
 */
export function restUntil(app: Appetite, c: { kind: Kind; lastSurfaced?: number; ignored: number }, cycle: number, now: number): number {
  if (c.lastSurfaced === undefined) return 0
  const p = Math.max(kindMean(app, c.kind, now), 0.02)
  return c.lastSurfaced + cycle * 2 ** c.ignored * (0.5 / p)
}

/** Remember a sent nudge until its outcome is known. Safe to call twice with the same id. */
export function nudged(app: Appetite, p: Pending): Appetite {
  if (app.pending.some((x) => x.id === p.id)) return app
  return { ...app, pending: [...app.pending, p] }
}

/** Apply one outcome to the counts. */
export function learn(app: Appetite, kind: Kind, result: Result, now: number): Appetite {
  const [ua, ub, ka, kb] = result === "engaged" ? [1, 0, 1, 0] : result === "ignored" ? [0, 1, 0, 1] : [0, 1, 0, DISMISS_WEIGHT]
  return { ...app, user: add(app.user, now, ua, ub), kinds: { ...app.kinds, [kind]: add(app.kinds[kind], now, ka, kb) } }
}

/**
 * Settle pending nudges from the signals that arrived and the clock. A dismissal of the nudge, its
 * loop, or its room after it was sent wins. Otherwise a human burst or a human task change in the
 * nudge's room before its deadline is engagement. A nudge past its deadline with neither is ignored.
 * Anything else stays pending.
 */
export function settle(app: Appetite, signals: Signal[], now: number): { appetite: Appetite; outcomes: Outcome[] } {
  const outcomes: Outcome[] = []
  const pending: Pending[] = []
  for (const p of app.pending) {
    const after = signals.filter((s) => s.at >= p.at && s.at <= p.deadline)
    const dismiss = after.find((s) => s.kind === "dismiss" && (s.nudge === p.id || s.loop === p.loop || (!s.nudge && !s.loop && s.room === p.room)))
    const engaged = after.find((s) => s.room === p.room && (s.kind === "burst" || (s.kind === "task" && s.by === "human")))
    if (dismiss) outcomes.push({ nudge: p, result: "dismissed", at: dismiss.at })
    else if (engaged) outcomes.push({ nudge: p, result: "engaged", at: engaged.at })
    else if (now >= p.deadline) outcomes.push({ nudge: p, result: "ignored", at: p.deadline })
    else pending.push(p)
  }
  let next: Appetite = { ...app, pending }
  for (const o of outcomes) next = learn(next, o.nudge.kind, o.result, o.at)
  return { appetite: next, outcomes }
}
