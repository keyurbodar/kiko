// Closed-loop simulation of the initiative attention pass, built from the repo's pure functions.
// Mirrors engine.ts: signals -> AttentionStore.observe -> arm (nextMoment) -> pass (items, Jev, attend) -> wake -> outcomes.
// Every variant sees the same human: sessions, loops, and the human's reaction to a given nudge are drawn from
// hash-keyed randomness, so two variants differ only where their decisions differ.
import * as AP from "../../../apps/server/src/initiative/attention/appetite"
import { attend, score } from "../../../apps/server/src/initiative/attention/attend"
import * as RH from "../../../apps/server/src/initiative/attention/rhythm"
import * as RHnopool from "./gen/rhythm-nopool"
import * as RHnosmooth from "./gen/rhythm-nosmooth"
import * as RHraw from "./gen/rhythm-raw"
import type { Candidate, Kind, Signal, Verdict } from "../../../apps/server/src/initiative/attention/types"

export const MIN = 60_000
export const HOUR = 60 * MIN
export const DAY = 24 * HOUR
const STEP = 15 * MIN
// The 20-hour gap between passes, as in engine.ts. GAP=0 drops it, to measure what the gap does (U66 D4, declined).
const MIN_GAP = process.env.GAP === "0" ? 0 : 20 * HOUR
const BUSY_MS = 120_000
const JEV_MAX = 10
const AWARE = process.env.HUMAN === "aware"
// SIGNAL=room models the engagement rule before U35: any human message in the nudge's chat before the deadline.
// The default models U35: the human answered the nudged item. RECALL is the share of meant replies the server
// recognises as answers (ASSUMPTION; see the U35 report), and a passing mention of the item counts too.
const ROOM_SIGNAL = process.env.SIGNAL === "room"
const RECALL = Number(process.env.RECALL ?? 1)
export const TZ = "America/Phoenix" // no DST, so local hours map to fixed UTC offsets (UTC-7)
export const START = Date.UTC(2026, 8, 7, 7) // Monday 00:00 local

// ---------- hash-keyed randomness ----------
function h32(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  h ^= h >>> 15
  h = Math.imul(h, 2246822507)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}
export const rnd = (...k: (string | number)[]) => h32(k.join("|"))

// ---------- personas ----------
export type Persona = {
  name: string
  hours: "regular" | "irregular" | "split"
  act: (k: Kind) => number // P(human replies in the nudge's room at their next session)
  dismiss: (k: Kind) => number // P(human says stop, given they did not act)
  loopRate: number // P(a session opens a human loop)
  closeRate: number // daily P(a human closes an open loop on their own)
}
const all = (p: number) => () => p
export const PERSONAS: Persona[] = [
  { name: "regular-keen", hours: "regular", act: all(0.75), dismiss: all(0.03), loopRate: 0.3, closeRate: 0.08 },
  { name: "regular-ignorer", hours: "regular", act: all(0.12), dismiss: all(0.05), loopRate: 0.3, closeRate: 0.08 },
  { name: "irregular-keen", hours: "irregular", act: all(0.7), dismiss: all(0.03), loopRate: 0.3, closeRate: 0.08 },
  { name: "irregular-ignorer", hours: "irregular", act: all(0.15), dismiss: all(0.05), loopRate: 0.3, closeRate: 0.08 },
  {
    name: "kind-split",
    hours: "regular",
    act: (k) => (k === "commitment" || k === "task" || k === "waiting" ? 0.85 : 0.08),
    dismiss: (k) => (k === "goal" || k === "project" ? 0.25 : 0.03),
    loopRate: 0.35,
    closeRate: 0.06,
  },
  { name: "weekday-weekend", hours: "split", act: all(0.5), dismiss: all(0.04), loopRate: 0.3, closeRate: 0.08 },
  { name: "hoarder", hours: "regular", act: all(0.4), dismiss: all(0.03), loopRate: 0.9, closeRate: 0.02 },
]

// Session start times (local hours) for one day.
function sessionsOn(p: Persona, seed: number, day: number): number[] {
  const dow = day % 7 // 0 = Monday
  const out: number[] = []
  const jitter = (k: string, sd: number) => (rnd(seed, p.name, day, k, "j1") + rnd(seed, p.name, day, k, "j2") - 1) * sd
  if (p.hours === "regular") {
    if (dow < 5) {
      if (rnd(seed, p.name, day, "m") < 0.9) out.push(8.5 + jitter("m", 0.6))
      if (rnd(seed, p.name, day, "l") < 0.4) out.push(12.5 + jitter("l", 0.5))
      if (rnd(seed, p.name, day, "e") < 0.85) out.push(21 + jitter("e", 0.8))
    } else if (rnd(seed, p.name, day, "w") < 0.7) out.push(11 + jitter("w", 1.5))
  } else if (p.hours === "irregular") {
    const n = Math.floor(rnd(seed, p.name, day, "n") * 4) // 0..3 sessions
    for (let i = 0; i < n; i++) out.push(7 + rnd(seed, p.name, day, "s", i) * 17)
  } else {
    if (dow < 5) {
      if (rnd(seed, p.name, day, "m") < 0.9) out.push(7.25 + jitter("m", 0.3))
      if (rnd(seed, p.name, day, "e") < 0.9) out.push(22 + jitter("e", 0.4))
    } else {
      if (rnd(seed, p.name, day, "a") < 0.85) out.push(13 + jitter("a", 0.7))
      if (rnd(seed, p.name, day, "b") < 0.6) out.push(16 + jitter("b", 0.7))
    }
  }
  return out.map((h) => START + day * DAY + Math.round((h * HOUR) / MIN) * MIN).sort((a, b) => a - b)
}

// ---------- world ----------
export const ROOM_SETS: Record<number, string[]> = { 1: ["home"], 3: ["home", "work", "trip"], 8: ["home", "work", "trip", "gym", "books", "money", "family", "code"] }
type Loop = {
  id: number
  kind: Kind
  certainty: "explicit" | "tentative"
  owner: string
  room: string
  due?: number
  mentions: number
  lastSeen: number
  openedAt: number
  open: boolean
  taskStatus?: boolean
}
type Mark = { surfaced: number; ignored: number; skipped: number; last_at: number | null }

// ---------- variants ----------
export type RhythmImpl = "168" | "24" | "168-nopool" | "168-nosmooth" | "168-raw"
export type Variant = {
  name: string
  rhythm: RhythmImpl
  appetite: "per-kind" | "pooled" | "none"
  judge: boolean
  worth: "score" | "simple" // no-judge worth, and the ranking used to pick Jev's ten
}
export const BASE: Variant = { name: "shipped", rhythm: "168", appetite: "per-kind", judge: false, worth: "score" }

function fold(r: RH.Rhythm): RH.Rhythm {
  const w = new Array(168).fill(0)
  for (let h = 0; h < 24; h++) {
    let s = 0
    for (let d = 0; d < 7; d++) s += r.w[d * 24 + h] ?? 0
    for (let d = 0; d < 7; d++) w[d * 24 + h] = s / 7
  }
  return { w, at: r.at }
}
function rhythmApi(impl: RhythmImpl) {
  const mod = impl === "168-nopool" ? RHnopool : impl === "168-nosmooth" ? RHnosmooth : impl === "168-raw" ? RHraw : RH
  const t = impl === "24" ? fold : (r: RH.Rhythm) => r
  return {
    view: (r: RH.Rhythm, now: number) => mod.view(t(r), now, TZ),
    nextMoment: (r: RH.Rhythm, now: number) => mod.nextMoment(t(r), now, TZ),
    ignoreDeadline: (r: RH.Rhythm, at: number) => mod.ignoreDeadline(t(r), at, TZ),
    known: (r: RH.Rhythm) => mod.known(r),
  }
}

// Simple worth: due urgency or an agent's promise near its date; nothing for mentions or staleness.
export function simple(c: Candidate, now: number, rhythm: RH.RhythmView): number {
  return score({ ...c, mentions: 0, certainty: "tentative" }, { now, rhythm })
}

const POOL_KIND = "goal" as Kind // pooled appetite keeps every outcome under one key
function appetiteView(app: AP.Appetite, mode: Variant["appetite"]): AP.Appetite {
  if (mode === "per-kind") return app
  if (mode === "none") return AP.emptyAppetite()
  const one = app.kinds[POOL_KIND]
  const kinds: Partial<Record<Kind, AP.Counts>> = {}
  if (one) for (const k of ["goal", "intention", "commitment", "waiting", "project", "task", "routine"] as Kind[]) kinds[k] = one
  return { ...app, kinds }
}

// ---------- Jev proxy ----------
// ASSUMPTION: Jev follows its own criteria text (judge.ts WORTH). Yes when due within a day, overdue, an agent's
// promise is owed, or the item has gone quiet for its kind; no when said in the last day, let pass, or declined before.
export function jevProxy(c: Candidate, now: number, skipped: number, noise: number): number {
  const letPass = c.ignored - skipped
  let yes = false
  if (c.due !== undefined && c.due <= now + DAY) yes = true
  if (c.owner !== "human" && (c.kind === "commitment" || c.kind === "task")) yes = true
  const quiet = now - c.lastSeen
  if ((c.kind === "goal" || c.kind === "project" || c.kind === "waiting") && quiet >= 7 * DAY) yes = true
  if (c.kind === "intention" && quiet >= 4 * DAY) yes = true
  if (c.kind === "routine") yes = true
  if (letPass > 0 || skipped > 0 || (now - c.lastSeen < DAY && (c.due === undefined || c.due > now))) yes = false
  if (c.certainty === "tentative" && (c.due === undefined || c.due > now + DAY)) yes = false
  return Math.min(0.97, Math.max(0.03, (yes ? 0.85 : 0.15) + (noise - 0.5) * 0.2))
}

// ---------- the simulated user DO ----------
export type PassLog = {
  at: number
  activeNow: boolean
  cycle: number
  nudged: string[]
  verdicts: Verdict[]
  items: { c: Candidate; skipped: number }[]
  appetite: AP.Appetite
  rhythm: RH.Rhythm
  worth: Record<string, number> | null
  busy: string[]
}
export type Result = {
  passes: PassLog[]
  nudges: { id: string; kind: Kind; at: number; intent: "reply" | "dismiss" | "none"; wait?: number; outcome?: AP.Result }[]
  outcomes: Record<string, number>
  byKind: Record<string, Record<string, number>>
  firstKnown: number | null
}

export function run(p: Persona, seed: number, weeks: number, v: Variant, roomCount = 3, hook?: (log: PassLog, s: { appetiteOf: (m: Variant["appetite"]) => AP.Appetite }) => void, shadows: Variant["appetite"][] = []): Result {
  const R = rhythmApi(v.rhythm)
  const ROOMS = ROOM_SETS[roomCount]!
  const pickRoom = (u: number) => (u < 0.5 ? ROOMS[0]! : ROOMS[1 + Math.floor(((u - 0.5) / 0.5) * (ROOMS.length - 1))] ?? ROOMS[0]!)
  let rhythm = RH.emptyRhythm()
  let appetite = AP.emptyAppetite()
  // Shadow appetites learn from the same outcomes, keyed differently, for open-loop comparison.
  const shadow: Record<string, AP.Appetite> = {}
  for (const m of shadows) shadow[m] = AP.emptyAppetite()
  const appKey = (k: Kind) => (v.appetite === "pooled" ? POOL_KIND : k)
  const loops: Loop[] = []
  const marks = new Map<string, Mark>()
  const lastHuman = new Map<string, number>()
  const intents: { kind: "reply" | "dismiss"; room: string; loop: string }[] = []
  let alarm: number | null = null
  let lastPass = 0
  let nextId = 1
  const res: Result = { passes: [], nudges: [], outcomes: {}, byKind: {}, firstKnown: null }
  const end = START + weeks * 7 * DAY

  const sessions: number[] = []
  for (let d = 0; d < weeks * 7; d++) sessions.push(...sessionsOn(p, seed, d))
  let si = 0

  const mark = (id: string, f: "surfaced" | "ignored" | "skipped" | null, at: number | null) => {
    const m = marks.get(id) ?? { surfaced: 0, ignored: 0, skipped: 0, last_at: null }
    if (f) m[f]++
    if (at !== null) m.last_at = at
    marks.set(id, m)
  }
  const loopById = (id: string) => loops.find((l) => `loop:${l.id}` === id || `task:${l.room}:${l.id}:${l.lastSeen}` === id)

  const applyOutcomes = (outs: AP.Outcome[]) => {
    for (const o of outs) {
      res.outcomes[o.result] = (res.outcomes[o.result] ?? 0) + 1
      const n = res.nudges.find((x) => x.id === o.nudge.id)
      if (n) {
        n.outcome = o.result
        const bk = (res.byKind[n.kind] ??= {})
        bk[o.result] = (bk[o.result] ?? 0) + 1
      }
      if (o.result === "ignored") mark(o.nudge.loop, "ignored", null)
      else if (o.result === "dismissed") {
        const l = loopById(o.nudge.loop)
        if (l) l.open = false
      }
    }
  }
  const observe = (signals: Signal[], now: number) => {
    for (const s of signals) if (s.kind === "burst") rhythm = RH.record(rhythm, s.at, TZ)
    const r = AP.settle(appetite, signals, now)
    appetite = r.appetite
    for (const m of shadows) shadow[m] = AP.settle(shadow[m]!, signals, now).appetite
    applyOutcomes(r.outcomes)
  }

  const items = (now: number, cycle: number) => {
    const out: { c: Candidate; skipped: number; loop: Loop }[] = []
    for (const l of loops) {
      if (!l.open) continue
      if (l.taskStatus && now - l.lastSeen < cycle) continue
      const id = l.taskStatus ? `task:${l.room}:${l.id}:${l.lastSeen}` : `loop:${l.id}`
      const m = marks.get(id)
      const c: Candidate = {
        id,
        kind: l.kind,
        certainty: l.certainty,
        owner: l.owner,
        room: l.room,
        ...(l.taskStatus ? { due: l.lastSeen + cycle } : l.due !== undefined ? { due: l.due } : {}),
        lastSeen: l.lastSeen,
        surfaced: m?.surfaced ?? 0,
        ignored: (m?.ignored ?? 0) + (m?.skipped ?? 0),
        ...(m?.last_at ? { lastSurfaced: m.last_at } : {}),
      }
      out.push({ c, skipped: m?.skipped ?? 0, loop: l })
    }
    return out
  }

  const arm = (now: number) => {
    if (!R.known(RH.decayed(rhythm, now))) return (alarm = null)
    const cycle = R.view(rhythm, now).cycle
    if (!items(now, cycle).length) return (alarm = null)
    alarm = R.nextMoment(RH.decayed(rhythm, Math.max(now, lastPass + MIN_GAP)), Math.max(now, lastPass + MIN_GAP))
    return alarm
  }

  const pass = (now: number) => {
    observe([], now)
    lastPass = now
    const view = R.view(rhythm, now)
    const its = items(now, view.cycle)
    const app = appetiteView(appetite, v.appetite)
    const busy = ROOMS.filter((r) => (lastHuman.get(r) ?? -Infinity) > now - BUSY_MS)
    const leads = Object.fromEntries(ROOMS.map((r) => [r, "@lead"]))
    const ctx = { now, level: "active" as const, away: false, budget: 10, busyRooms: busy, leads, rhythm: view, appetite: app }
    const rank = (c: Candidate) => (v.worth === "score" ? score(c, ctx) : simple(c, now, view))
    let worth: Record<string, number> | null = null
    if (v.judge && its.length && view.known && view.activeNow && AP.allowance(app, now) > 0) {
      const eligible = its
        .filter((i) => now >= AP.restUntil(i.c, view.cycle) && !busy.includes(i.c.room))
        .sort((a, b) => rank(b.c) - rank(a.c))
        .slice(0, JEV_MAX)
      if (eligible.length) worth = Object.fromEntries(eligible.map((i) => [i.c.id, jevProxy(i.c, now, i.skipped, rnd(seed, p.name, "jev", i.c.id, i.c.surfaced, Math.floor(now / DAY)))]))
    } else if (!v.judge && v.worth === "simple") {
      // Feed the simple worth through the judge slot; tentative items get 0, as attend briefs them without Jev.
      worth = Object.fromEntries(its.map((i) => [i.c.id, i.c.certainty === "tentative" ? 0 : simple(i.c, now, view)]))
    }
    const verdicts = attend(
      its.map((i) => i.c),
      { ...ctx, ...(worth ? { worthNow: worth } : {}) },
    )
    const log: PassLog = { at: now, activeNow: view.activeNow, cycle: view.cycle, nudged: [], verdicts, items: its.map(({ c, skipped }) => ({ c, skipped })), appetite, rhythm, worth, busy }
    for (const vd of verdicts) {
      if (vd.verdict !== "nudge") continue
      const it = its.find((i) => i.c.id === vd.id)!
      log.nudged.push(vd.id)
      const k = it.c.kind
      // The agent's run: [skip] 10% of the time.
      const r0 = rnd(seed, p.name, "run", vd.id, it.c.surfaced, it.c.ignored)
      if (r0 < 0.1) {
        mark(vd.id, "skipped", now)
        appetite = AP.learn(appetite, appKey(k), "skipped", now)
        for (const m of shadows) shadow[m] = AP.learn(shadow[m]!, m === "pooled" ? POOL_KIND : k, "skipped", now)
        res.outcomes.skipped = (res.outcomes.skipped ?? 0) + 1
        continue
      }
      mark(vd.id, "surfaced", now)
      const nid = `${vd.id}#${now}`
      const pend = { id: nid, room: it.c.room, loop: vd.id, at: now, deadline: R.ignoreDeadline(rhythm, now) }
      appetite = AP.nudged(appetite, { ...pend, kind: appKey(k) })
      for (const m of shadows) shadow[m] = AP.nudged(shadow[m]!, { ...pend, kind: m === "pooled" ? POOL_KIND : k })
      const nudgeRec: Result["nudges"][number] = { id: nid, kind: k, at: now, intent: "none" }
      res.nudges.push(nudgeRec)
      if (it.c.owner !== "human" && k === "commitment") it.loop.open = false
      if (it.loop.taskStatus && rnd(seed, p.name, "taskdone", vd.id) < 0.5) it.loop.open = false
      // The human's reaction, keyed by the item and how often it was raised, so variants share it.
      const r1 = rnd(seed, p.name, "act", vd.id, it.c.surfaced)
      const wait = (sessions.find((x) => x >= now) ?? end + DAY) - now
      nudgeRec.wait = wait
      let pAct = p.act(k)
      if (AWARE) {
        // ASSUMPTION: a nudge is more welcome when it lands just before the human shows up, when the item is
        // urgent, and when the human has not been nudged much in the last three days.
        pAct *= wait <= HOUR ? 1 : wait <= 4 * HOUR ? 0.85 : wait <= 12 * HOUR ? 0.6 : 0.4
        if ((it.c.due !== undefined && it.c.due <= now + DAY) || (it.c.owner !== "human" && (k === "commitment" || k === "task"))) pAct *= 1.25
        else if (it.c.due === undefined && now - it.c.lastSeen < 3 * DAY) pAct *= 0.7
        pAct *= 0.8 ** res.nudges.filter((x) => x !== nudgeRec && x.at > now - 3 * DAY).length
        pAct = Math.min(0.95, pAct)
      }
      if (r1 < pAct) { intents.push({ kind: "reply", room: it.c.room, loop: vd.id }); nudgeRec.intent = "reply" }
      else if (rnd(seed, p.name, "dis", vd.id, it.c.surfaced) < p.dismiss(k)) { intents.push({ kind: "dismiss", room: it.c.room, loop: vd.id }); nudgeRec.intent = "dismiss" }
    }
    hook?.(log, { appetiteOf: (m) => (m === "per-kind" && v.appetite === "per-kind" ? appetite : appetiteView(shadow[m] ?? appetite, m)) })
    res.passes.push(log)
    arm(now)
  }

  for (let t = START; t < end; t += STEP) {
    // daily: the human closes some loops on their own
    if ((t - START) % DAY === 0) {
      const day = (t - START) / DAY
      for (const l of loops) if (l.open && l.owner === "human" && rnd(seed, p.name, "close", l.id, day) < p.closeRate) l.open = false
      // agent tasks: some get stuck
      if (rnd(seed, p.name, "task", day) < 0.15) {
        loops.push({ id: nextId++, kind: "task", certainty: "explicit", owner: "scout", room: pickRoom(rnd(seed, p.name, "troom", day)), mentions: 1, lastSeen: t, openedAt: t, open: true, taskStatus: true })
      }
      for (const l of loops) if (l.taskStatus && l.open && rnd(seed, p.name, "tclose", l.id, day) < 0.25) l.open = false
    }
    if (alarm !== null && alarm <= t) pass(t)
    while (si < sessions.length && sessions[si]! < t + STEP) {
      const at = sessions[si]!
      si++
      const signals: Signal[] = []
      const nb = 1 + Math.floor(rnd(seed, p.name, "nb", at) * 3)
      const queued = intents.splice(0)
      for (let b = 0; b < nb; b++) {
        const bt = at + b * 4 * MIN
        const room = b < queued.length ? queued[b]!.room : pickRoom(rnd(seed, p.name, "room", at, b))
        signals.push({ kind: "burst", id: `b:${bt}:${b}`, room, at: bt })
        lastHuman.set(room, bt)
        if (ROOM_SIGNAL) for (const n of appetite.pending) if (n.room === room) signals.push({ kind: "answer", id: `a:${bt}:${n.loop}`, room, at: bt, loop: n.loop })
        // mentions of open loops in this room
        for (const l of loops) if (l.open && !l.taskStatus && l.room === room && rnd(seed, p.name, "touch", l.id, bt) < 0.08) {
          l.mentions++
          l.lastSeen = bt
          if (!ROOM_SIGNAL) signals.push({ kind: "answer", id: `t:${bt}:${l.id}`, room, at: bt, loop: `loop:${l.id}` })
        }
        // a new loop
        if (rnd(seed, p.name, "open", bt) < p.loopRate / nb) {
          const u = rnd(seed, p.name, "kind", bt)
          const kind: Kind = u < 0.4 ? "intention" : u < 0.55 ? "goal" : u < 0.8 ? "waiting" : "project"
          const hasDue = kind === "intention" ? rnd(seed, p.name, "due", bt) < 0.6 : kind === "waiting" ? rnd(seed, p.name, "due", bt) < 0.3 : false
          loops.push({
            id: nextId++,
            kind,
            certainty: rnd(seed, p.name, "cert", bt) < 0.75 ? "explicit" : "tentative",
            owner: "human",
            room,
            ...(hasDue ? { due: bt + (0.5 + rnd(seed, p.name, "dd", bt) * 5) * DAY } : {}),
            mentions: 1,
            lastSeen: bt,
            openedAt: bt,
            open: true,
          })
        }
        if (rnd(seed, p.name, "promise", bt) < 0.1 / nb) {
          loops.push({ id: nextId++, kind: "commitment", certainty: "explicit", owner: "scout", room, due: bt + (1 + rnd(seed, p.name, "pd", bt) * 2) * DAY, mentions: 1, lastSeen: bt, openedAt: bt, open: true })
        }
      }
      for (const q of queued) {
        const l = loopById(q.loop)
        if (!ROOM_SIGNAL && q.kind === "reply" && rnd(seed, p.name, "recall", q.loop, at) < RECALL) signals.push({ kind: "answer", id: `r:${at}:${q.loop}`, room: q.room, at, loop: q.loop })
        if (q.kind === "dismiss") {
          signals.push({ kind: "dismiss", id: `d:${at}:${q.loop}`, room: q.room, at: at + MIN, loop: q.loop })
          if (l) l.open = false
        } else if (l && !l.taskStatus) {
          l.mentions++
          l.lastSeen = at
          if (rnd(seed, p.name, "done", q.loop, at) < 0.6) l.open = false
        }
      }
      observe(signals, at + nb * 4 * MIN)
      if (res.firstKnown === null && R.known(rhythm)) res.firstKnown = at
      arm(at + nb * 4 * MIN)
    }
  }
  observe([], end + 15 * DAY) // settle what is still pending
  return res
}
