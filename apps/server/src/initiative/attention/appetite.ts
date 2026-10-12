import type { Kind, Signal } from "./types"

export type Counts = { a: number; b: number; at: number }

/** `seq` and `what`: the nudge's last bubble, which a human reply quotes and Jev reads. */
export type Pending = { id: string; room: string; kind: Kind; loop: string; at: number; deadline: number; seq?: number; what?: string; engaged?: number }

export type Appetite = { user: Counts; kinds: Partial<Record<Kind, Counts>>; pending: Pending[] }

export type Result = "engaged" | "ignored" | "dismissed" | "skipped"
export type Outcome = { nudge: Pending; result: Result; at: number }

const DAY = 86_400_000
const HALF_LIFE = 14 * DAY
// The per-item ignore count never fades like the appetite does, so its rest stops doubling here.
const MAX_DOUBLINGS = 3
const DISMISS_WEIGHT = 5
const MAX_PER_PASS = 3
const GATE = 0.5

const WEIGHTS: Record<Result, [number, number, number, number]> = {
  engaged: [1, 0, 1, 0],
  ignored: [0, 1, 0, 1],
  dismissed: [0, 1, 0, DISMISS_WEIGHT],
  skipped: [0, 0, 0, 1],
}

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

function posterior(c: Counts | undefined, now: number): { mean: number; sd: number } {
  const f = c ? fade(c, now) : { a: 0, b: 0 }
  const a = f.a + 1
  const b = f.b + 1
  const n = a + b
  return { mean: a / n, sd: Math.sqrt((a * b) / (n * n * (n + 1))) }
}

export function kindOpen(app: Appetite, kind: Kind, now: number): boolean {
  const p = posterior(app.kinds[kind], now)
  return p.mean + p.sd > GATE
}

export function allowance(app: Appetite, now: number): number {
  const p = posterior(app.user, now)
  let n = 0
  while (n < MAX_PER_PASS && p.mean + p.sd * (1 - 2 * n) > GATE) n++
  return n
}

export function restUntil(c: { lastSurfaced?: number; ignored: number }, cycle: number): number {
  if (c.lastSurfaced === undefined) return 0
  return c.lastSurfaced + cycle * 2 ** Math.min(c.ignored, MAX_DOUBLINGS)
}

export function nudged(app: Appetite, p: Pending): Appetite {
  if (app.pending.some((x) => x.id === p.id)) return app
  return { ...app, pending: [...app.pending, p] }
}

export function learn(app: Appetite, kind: Kind, result: Result, now: number): Appetite {
  const [ua, ub, ka, kb] = WEIGHTS[result]
  return { ...app, user: add(app.user, now, ua, ub), kinds: { ...app.kinds, [kind]: add(app.kinds[kind], now, ka, kb) } }
}

export function settle(app: Appetite, signals: readonly Signal[], now: number): { appetite: Appetite; outcomes: Outcome[] } {
  const outcomes: Outcome[] = []
  const pending: Pending[] = []
  for (const p of app.pending) {
    const inside = signals.filter((s) => s.at >= p.at && s.at <= p.deadline)
    const dismiss = inside.find((s) => s.kind === "dismiss" && s.loop === p.loop)
    const engaged = p.engaged ?? inside.find((s) => s.kind === "answer" && s.loop === p.loop)?.at
    if (dismiss) outcomes.push({ nudge: p, result: "dismissed", at: dismiss.at })
    else if (now >= p.deadline) outcomes.push({ nudge: p, result: engaged === undefined ? "ignored" : "engaged", at: engaged ?? p.deadline })
    else pending.push(engaged === undefined ? p : { ...p, engaged })
  }
  let next: Appetite = { ...app, pending }
  for (const o of outcomes) next = learn(next, o.nudge.kind, o.result, o.at)
  return { appetite: next, outcomes }
}
