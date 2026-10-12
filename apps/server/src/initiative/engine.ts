import type { Judge } from "@yuki/memory/judge"
import { keywords } from "@yuki/memory/life"
import { type Loops, loopLine } from "@yuki/memory/loops"
import type { AgentSlug } from "@yuki/protocol"
import type { SignalBatch } from "../room/signals"
import type { WakeResult } from "../room/wake"
import type { ChatTasks } from "../user/overview"
import type { Reminder, RoutineRun } from "../user/reminders"
import { allowance, type Outcome, restUntil } from "./attention/appetite"
import { attend, LEAD, rankOrder } from "./attention/attend"
import { decayed, emptyRhythm, known, nextMoment, slotOf, view } from "./attention/rhythm"
import { AttentionStore } from "./attention/store"
import { getSetting, setSetting } from "../lib/settings"
import type { Candidate, Kind, Level, Signal, Verdict } from "./attention/types"
import { type WorthItem, worthNow } from "./judge"

export const INITIATIVE_RUN = "initiative"
export const REMINDER_RUN = "reminder"
export const INITIATIVE_WAKEUP = "initiative_pass"

const MIN_GAP = 20 * 3_600_000
const JEV_MAX = 10
const BUSY_MS = 120_000
const KEEP_MS = 90 * 86_400_000
const NOTICED_MAX = 2
export const SHARED_WORDS = 2
const LAST_PASS = "initiative_last_pass"
const REMINDER_RUN_WINDOW = 3_600_000

export type WakeInput = { id: string; to: AgentSlug | null; body: string; reason: string }

type EngineDeps = {
  sql: SqlStorage
  loops: Loops
  tz: () => string
  level: () => Level
  away: () => boolean
  budget: () => number
  title: (roomId: string) => string | null
  home: () => string | null
  routines: () => { routine: Reminder; last: RoutineRun | null }[]
  judge: () => Judge | null
  /** Whether Jev reads this chat's bursts for nudge answers: then its verdict decides, not the two-word touch. */
  judged: (roomId: string) => boolean
  wake: (roomId: string, input: WakeInput) => Promise<WakeResult | "busy">
  count: (delta: Record<string, number>) => void
  setWakeup: (at: number) => Promise<void>
  clearWakeup: () => Promise<void>
}

type Item = { c: Candidate; text: string; line: string; reason: string; skipped: number; loopId?: number }

type Mark = { surfaced: number; ignored: number; skipped: number; last_at: number | null }

type PassReport = {
  at: number
  rhythm: { known: boolean; activeNow: boolean; cycle: number }
  jev: boolean
  verdicts: (Verdict & { text: string })[]
  woke: { id: string; room: string; to: string; result: WakeResult | "busy"; ids: string[] }[]
}

export class InitiativeEngine {
  private readonly store: AttentionStore

  constructor(private readonly d: EngineDeps) {
    this.store = new AttentionStore(d.sql)
  }

  link(reminderId: string, loopId: number): void {
    this.d.sql.exec("INSERT OR REPLACE INTO loop_reminders (reminder_id, loop_id) VALUES (?, ?)", reminderId, loopId)
  }

  async signals(batch: SignalBatch, now = Date.now()): Promise<void> {
    const heard: Signal[] = []
    const fresh = this.store.unseen(batch.signals.flatMap((s) => (s.kind === "burst" ? [`burst:${s.roomId}:${s.seq}`] : [])))
    for (const s of batch.signals) {
      if (s.kind === "routine_result" && s.routineId === INITIATIVE_RUN) this.ran(s, now)
      else if (s.kind === "routine_result" && s.routineId === REMINDER_RUN) this.kept(s.occurrence, s.outcome === "ok", now)
      else if (s.kind === "burst" && s.by.kind === "human") {
        heard.push({ kind: "burst", id: `burst:${s.roomId}:${s.seq}`, room: s.roomId, at: s.at })
        const quoted = s.answers
        if (quoted !== undefined) {
          // A nudge may be two bubbles, and the pending one knows only its last: the quote belongs to the first nudge that ends at or after it.
          const nudge = this.store.appetite().pending.filter((p) => p.room === s.roomId && (p.seq ?? -1) >= quoted).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))[0]
          if (nudge) heard.push(answer(nudge.loop, s.roomId, `${s.seq}`, s.at))
        }
        this.d.sql.exec("INSERT INTO initiative_rooms (room_id, human_at) VALUES (?, ?) ON CONFLICT(room_id) DO UPDATE SET human_at = max(human_at, excluded.human_at)", s.roomId, s.at)
        if (fresh.has(`burst:${s.roomId}:${s.seq}`)) {
          // Where Jev reads bursts, it judges the burst against the nudge (initiative.ts) and its verdict decides; sharing two words is the rule only elsewhere.
          const judged = this.d.judged(s.roomId)
          for (const id of this.touched(s.roomId, s.text, s.at)) if (!judged) heard.push(answer(`loop:${id}`, s.roomId, `${s.seq}`, s.at))
        }
      }
    }
    this.apply(this.store.observe(heard, now, this.d.tz()))
    await this.arm(now)
  }

  /** A burst Jev could not judge (its pass failed for good) falls back to the two-word touch, so a reply still counts as engagement. */
  fallback(roomId: string, text: string, messageId: string, at: number, now = Date.now()): void {
    this.apply(this.store.observe(this.touched(roomId, text, at).map((id) => answer(`loop:${id}`, roomId, messageId, at)), now, this.d.tz()))
  }

  /** The nudges in a chat still waiting for the human, for Jev to judge whether a burst answers one. */
  nudges(roomId: string): { loop: string; what: string }[] {
    return this.store.appetite().pending.flatMap((p) => (p.room === roomId && p.what !== undefined ? [{ loop: p.loop, what: p.what }] : []))
  }

  answered(roomId: string, loop: string, messageId: string, at: number, now = Date.now()): void {
    this.apply(this.store.observe([answer(loop, roomId, messageId, at)], now, this.d.tz()))
  }

  dropped(id: number, now = Date.now()): void {
    const loop = `loop:${id}`
    const pending = this.store.appetite().pending.find((p) => p.loop === loop)
    if (pending) this.apply(this.store.observe([{ kind: "dismiss", id: `dismiss:${loop}:${now}`, room: pending.room, at: now, loop }], now, this.d.tz()))
  }

  /** The loops of this chat that a burst shares at least two words with. Each is touched; returns their ids. */
  private touched(roomId: string, text: string, at: number): number[] {
    if (this.d.title(roomId) === null) return []
    const said = new Set(keywords(text))
    const ids: number[] = []
    for (const l of this.d.loops.similar(text, 2)) {
      if (l.room !== roomId || keywords(l.text).filter((w) => said.has(w)).length < SHARED_WORDS) continue
      this.d.loops.touch(l.id, at)
      ids.push(l.id)
    }
    return ids
  }

  private ran(result: Extract<SignalBatch["signals"][number], { kind: "routine_result" }>, now: number): void {
    const { occurrence: wakeId, outcome } = result
    const row = this.d.sql.exec<{ room: string; slug: string; kind: string; ids: string; status: string }>("SELECT * FROM initiative_wakes WHERE id = ?", wakeId).toArray()[0]
    if (row?.status !== "pending") return
    const id = row.ids
    const kind = row.kind as Kind
    const status = outcome === "ok" ? "spoke" : outcome === "quiet" ? "skipped" : "failed"
    this.d.sql.exec("UPDATE initiative_wakes SET status = ? WHERE id = ?", status, wakeId)
    this.mark(id, status === "spoke" ? "surfaced" : status === "skipped" ? "skipped" : null, now)
    if (status === "spoke") {
      this.store.sent({ id: wakeId, room: row.room, kind, loop: id, at: now, ...(result.seq === null ? {} : { seq: result.seq }), ...(result.text === undefined ? {} : { what: result.text }) }, this.d.tz())
      const loop = loopIdOf(id)
      if (loop !== null && row.slug !== LEAD && this.d.loops.get(loop)?.owner === row.slug) this.d.loops.close(loop, "done", now)
    } else if (status === "skipped") this.store.skipped(kind, now)
    this.d.count({ [`initiative_${status}`]: 1 })
  }

  private kept(reminderId: string, posted: boolean, now: number): void {
    if (posted) {
      for (const r of this.d.sql.exec<{ loop_id: number }>("SELECT loop_id FROM loop_reminders WHERE reminder_id = ?", reminderId).toArray()) {
        if (this.d.loops.close(r.loop_id, "done", now)) this.d.count({ loops_closed: 1 })
      }
    }
    this.d.sql.exec("DELETE FROM loop_reminders WHERE reminder_id = ?", reminderId)
  }

  private apply(outcomes: Outcome[]): void {
    for (const o of outcomes) {
      if (o.result === "ignored") this.mark(o.nudge.loop, "ignored", null)
      else if (o.result === "dismissed") {
        const loop = loopIdOf(o.nudge.loop)
        if (loop !== null) this.d.loops.close(loop, "dropped", o.at)
      }
      this.d.count({ [`initiative_${o.result}`]: 1 })
    }
  }

  private mark(id: string, field: "surfaced" | "ignored" | "skipped" | null, at: number | null): void {
    const add = (f: string) => (f === field ? 1 : 0)
    this.d.sql.exec(
      `INSERT INTO initiative_marks (id, surfaced, ignored, skipped, last_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET surfaced = surfaced + excluded.surfaced, ignored = ignored + excluded.ignored, skipped = skipped + excluded.skipped, last_at = coalesce(excluded.last_at, last_at)`,
      id,
      add("surfaced"),
      add("ignored"),
      add("skipped"),
      at,
    )
  }

  private items(now: number, cycle: number): Item[] {
    const tz = this.d.tz()
    const found: { id: string; c: Omit<Candidate, "id" | "surfaced" | "ignored" | "lastSurfaced">; rest: Omit<Item, "c" | "skipped"> }[] = []
    const home = this.d.home()
    const add = (id: string, c: Omit<Candidate, "id" | "surfaced" | "ignored" | "lastSurfaced">, rest: Omit<Item, "c" | "skipped">) => {
      found.push({ id, c, rest })
    }
    const kept = new Set(
      this.d.sql
        .exec<{ loop_id: number }>(
          "SELECT loop_id FROM loop_reminders WHERE reminder_id IN (SELECT id FROM reminders WHERE status = 'active' OR (status = 'done' AND last_fired > ?))",
          now - REMINDER_RUN_WINDOW,
        )
        .toArray()
        .map((r) => r.loop_id),
    )
    for (const l of this.d.loops.candidates(now)) {
      if (kept.has(l.id)) continue
      const room = l.room && this.d.title(l.room) !== null ? l.room : l.room ? null : home
      if (!room) continue
      const due = l.due ? Date.parse(l.due) : undefined
      const said = l.owner === "human" ? "said" : `@${l.owner} promised`
      add(
        `loop:${l.id}`,
        { kind: l.kind, certainty: l.certainty, owner: l.owner, room, ...(due !== undefined && !Number.isNaN(due) ? { due } : {}), lastSeen: l.lastSeen },
        { text: l.text, line: `${loopLine(l)} (${said} ${day(l.openedAt, tz)}, last mentioned ${ago(l.lastSeen, now)})`, reason: l.owner === "human" ? `You mentioned this ${day(l.openedAt, tz)}` : `Promised ${day(l.openedAt, tz)}`, loopId: l.id },
      )
    }
    for (const r of this.d.sql.exec<{ room_id: string; tasks: string }>("SELECT room_id, tasks FROM chat_tasks").toArray()) {
      if (this.d.title(r.room_id) === null) continue
      for (const t of (JSON.parse(r.tasks) as ChatTasks).oldest) {
        if (!t.id || !["doing", "blocked", "review"].includes(t.status) || now - t.updatedAt < cycle) continue
        const owner = t.status === "review" || !t.owner ? "human" : t.owner
        add(
          `task:${r.room_id}:${t.id}:${t.updatedAt}`,
          { kind: "task", certainty: "explicit", owner, room: r.room_id, due: t.updatedAt + cycle, lastSeen: t.updatedAt },
          { text: t.title, line: `task ${t.id} "${t.title}" is ${t.status}${t.owner ? `, owner @${t.owner}` : ""}, untouched ${ago(t.updatedAt, now)}`, reason: `Untouched for ${span(now - t.updatedAt)}` },
        )
      }
    }
    for (const { routine, last } of this.d.routines()) {
      const failed = last?.status === "failed" || last?.status === "timeout"
      if (!routine.trigger || !(routine.status === "paused" || (routine.status === "active" && failed)) || this.d.title(routine.roomId) === null) continue
      const at = last?.startedAt ?? now
      const what = routine.status === "paused" ? "is paused" : `last run ${last?.status} ${ago(at, now)}`
      add(
        `routine:${routine.id}:${last?.occurrence ?? routine.status}`,
        { kind: "routine", certainty: "explicit", owner: "human", room: routine.roomId, due: at, lastSeen: at },
        { text: routine.name ?? "a routine", line: `routine "${routine.name ?? routine.id}" (${routine.id}) ${what}`, reason: routine.status === "paused" ? "A routine paused" : "A routine failed" },
      )
    }
    const marks = new Map(
      this.d.sql
        .exec<Mark & { id: string }>("SELECT * FROM initiative_marks WHERE id IN (SELECT value FROM json_each(?))", JSON.stringify(found.map((f) => f.id)))
        .toArray()
        .map((m) => [m.id, m]),
    )
    return found.map(({ id, c, rest }): Item => {
      const m = marks.get(id)
      return { c: { ...c, id, surfaced: m?.surfaced ?? 0, ignored: (m?.ignored ?? 0) + (m?.skipped ?? 0), ...(m?.last_at ? { lastSurfaced: m.last_at } : {}) }, skipped: m?.skipped ?? 0, ...rest }
    })
  }

  /** Rows older than KEEP_MS cannot change a decision: the longest rest is eight cycles, and a cycle is at most eight days. */
  private prune(now: number): void {
    const cutoff = now - KEEP_MS
    this.d.sql.exec("DELETE FROM initiative_marks WHERE last_at < ?", cutoff)
    this.d.sql.exec("DELETE FROM initiative_briefed WHERE at < ?", cutoff)
    this.d.sql.exec("DELETE FROM initiative_wakes WHERE at < ? AND status != 'pending'", cutoff)
  }

  private lastPass(): number {
    return Number(getSetting(this.d.sql, LAST_PASS) ?? 0)
  }

  async arm(now = Date.now()): Promise<number | null> {
    const level = this.d.level()
    const rhythm = decayed(this.store.rhythm(), now)
    if (level === "off" || level === "chat" || !known(rhythm) || !this.items(now, view(rhythm, now, this.d.tz()).cycle).length) {
      await this.d.clearWakeup()
      return null
    }
    const at = nextMoment(rhythm, Math.max(now, this.lastPass() + MIN_GAP), this.d.tz())
    if (at === null) await this.d.clearWakeup()
    else await this.d.setWakeup(at)
    return at
  }

  async pass(now = Date.now()): Promise<PassReport> {
    const tz = this.d.tz()
    const store = this.store
    this.apply(store.observe([], now, tz))
    this.prune(now)
    setSetting(this.d.sql, LAST_PASS, String(now))
    const rhythm = view(store.rhythm(), now, tz)
    const items = this.items(now, rhythm.cycle)
    const report: PassReport = { at: now, rhythm: { known: rhythm.known, activeNow: rhythm.activeNow, cycle: rhythm.cycle }, jev: false, verdicts: [], woke: [] }
    const level = this.d.level()
    if (level === "off" || level === "chat") return report
    const appetite = store.appetite()
    const busyRooms = this.d.sql.exec<{ room_id: string }>("SELECT room_id FROM initiative_rooms WHERE human_at > ?", now - BUSY_MS).toArray().map((r) => r.room_id)
    const away = this.d.away()
    const budget = this.d.budget()
    const ctx = { now, level, away, budget, busyRooms, rhythm, appetite }
    let worth: Record<string, number> | null = null
    const judge = this.d.judge()
    if (judge && items.length && (level === "digest" || level === "active") && rhythm.known && rhythm.activeNow && !away && budget > 0 && allowance(appetite, now) > 0) {
      const rank = rankOrder(ctx)
      const eligible = items
        .filter((i) => now >= restUntil(i.c, rhythm.cycle) && !busyRooms.includes(i.c.room))
        .sort((a, b) => rank(a.c, b.c))
        .slice(0, JEV_MAX)
      if (eligible.length) {
        const u = appetite.user
        worth = await worthNow(
          judge,
          eligible.map((i) => worthItem(i, now)),
          { now: localNow(now, tz), the_agent_is_told: NUDGE_RULE, nudges_the_human_answered_lately: Math.round(u.a), nudges_the_human_let_pass_lately: Math.round(u.b) },
        )
        if (worth) {
          report.jev = true
          this.d.count({ initiative_jev: 1 })
        }
      }
    }
    const verdicts = attend(
      items.map((i) => i.c),
      { ...ctx, ...(worth ? { worthNow: worth } : {}) },
    )
    const byId = new Map(items.map((i) => [i.c.id, i]))
    const itemOf = (id: string) => {
      const item = byId.get(id)
      if (!item) throw new Error(`initiative verdict for unknown candidate ${id}`)
      return item
    }
    report.verdicts = verdicts.map((v) => ({ ...v, text: itemOf(v.id).text }))
    for (const v of verdicts) {
      if (v.verdict !== "nudge") continue
      const item = itemOf(v.id)
      const own = item.c.owner !== "human"
      const slug = own ? v.target.slug : LEAD
      const id = `${item.c.id}#${item.c.lastSurfaced ?? 0}`
      const result = await this.d.wake(item.c.room, { id, to: own ? (slug as AgentSlug) : null, body: wakeBody(item, own), reason: item.reason })
      if (result === "delivered") {
        this.d.sql.exec("INSERT OR IGNORE INTO initiative_wakes (id, room, slug, kind, ids, at, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')", id, item.c.room, slug, item.c.kind, item.c.id, now)
        this.d.count({ initiative_woke: 1 })
      } else if (result === "duplicate" && !this.d.sql.exec("SELECT 1 FROM initiative_wakes WHERE id = ?", id).toArray().length) {
        this.mark(item.c.id, null, now)
        this.d.count({ initiative_failed: 1 })
      }
      report.woke.push({ id, room: item.c.room, to: own ? slug : "lead", result, ids: [item.c.id] })
    }
    await this.arm(now)
    return report
  }

  noticed(roomId: string, skip: ReadonlySet<number>, now = Date.now()): string[] {
    if (this.d.level() === "off") return []
    const rhythm = view(this.store.rhythm(), now, this.d.tz())
    const briefed = new Map(this.d.sql.exec<{ loop_id: number; at: number }>("SELECT loop_id, at FROM initiative_briefed").toArray().map((r) => [r.loop_id, r.at]))
    const rank = rankOrder({ now, rhythm })
    const picked = this.items(now, rhythm.cycle)
      .filter(
        (i): i is Item & { loopId: number } =>
          i.loopId !== undefined &&
          i.c.owner === "human" &&
          i.c.room === roomId &&
          i.c.certainty === "explicit" &&
          !skip.has(i.loopId) &&
          now >= restUntil(i.c, rhythm.cycle) &&
          now >= (briefed.get(i.loopId) ?? -Infinity) + rhythm.cycle,
      )
      .sort((a, b) => rank(a.c, b.c))
      .slice(0, NOTICED_MAX)
    for (const i of picked) this.d.sql.exec("INSERT INTO initiative_briefed (loop_id, at) VALUES (?, ?) ON CONFLICT(loop_id) DO UPDATE SET at = excluded.at", i.loopId, now)
    return picked.map((i) => i.line)
  }

  devAge(ms: number): void {
    const { sql } = this.d
    sql.exec("UPDATE loops SET opened_at = opened_at - ?, last_seen = last_seen - ?, snoozed_until = snoozed_until - ?", ms, ms, ms)
    for (const r of sql.exec<{ id: number; due: string }>("SELECT id, due FROM loops WHERE due IS NOT NULL").toArray()) {
      const at = Date.parse(r.due)
      if (!Number.isNaN(at)) sql.exec("UPDATE loops SET due = ? WHERE id = ?", new Date(at - ms).toISOString(), r.id)
    }
    sql.exec("UPDATE initiative_marks SET last_at = last_at - ?", ms)
    sql.exec("UPDATE initiative_briefed SET at = at - ?", ms)
    sql.exec("UPDATE initiative_wakes SET at = at - ?", ms)
    sql.exec("UPDATE initiative_rooms SET human_at = human_at - ?", ms)
    setSetting(this.d.sql, LAST_PASS, String(this.lastPass() - ms))
    this.store.devShift(ms)
  }

  devRhythm(mode: "now" | "clear", now = Date.now()): void {
    const r = emptyRhythm()
    if (mode === "now") {
      const hour = slotOf(now, this.d.tz()) % 24
      for (let d = 0; d < 7; d++) r.w[d * 24 + hour] = 2
      r.at = now
    }
    this.store.devRhythm(r)
  }

  devState(): { rhythm: ReturnType<typeof view>; appetite: ReturnType<AttentionStore["appetite"]>; marks: (Mark & { id: string })[]; wakes: unknown[] } {
    return {
      rhythm: view(this.store.rhythm(), Date.now(), this.d.tz()),
      appetite: this.store.appetite(),
      marks: this.d.sql.exec<Mark & { id: string }>("SELECT * FROM initiative_marks").toArray(),
      wakes: this.d.sql.exec("SELECT * FROM initiative_wakes ORDER BY at").toArray(),
    }
  }
}

const NUDGE_RULE = "one short message in your own words, at most two sentences. no text around tool calls. reply only [skip] when this chat shows it is already handled."

function wakeBody(i: Item, own: boolean): string {
  if (own && i.loopId !== undefined) {
    return [
      `initiative: you promised this and it is still open: ${i.line}.`,
      "keep it now in one short message: the result, or one line on why you cannot. no text around tool calls.",
      `then close L${i.loopId} done with the loop tool. if this chat shows it was already kept, close it and reply only [skip].`,
    ].join("\n")
  }
  if (own) return [`initiative: your ${i.line}.`, `move it on if you can, then tell the human where it stands or what is in the way: ${NUDGE_RULE}`].join("\n")
  return [
    `initiative: the human usually writes around now, and this looks worth raising:\n- ${i.line}`,
    `raise it now: ${NUDGE_RULE} if it is a teammate's work, ask that teammate with send_message instead.`,
    i.loopId === undefined ? "" : `if the human says they no longer want it, close L${i.loopId} as dropped with the loop tool.`,
  ]
    .filter(Boolean)
    .join("\n")
}

function worthItem(i: Item, now: number): WorthItem {
  const c = i.c
  return {
    id: c.id,
    what: i.text,
    whose: c.kind === "task" ? `a task ${c.owner === "human" ? "waiting on the human" : `owned by agent @${c.owner}`}` : c.kind === "routine" ? "the human's routine, in trouble" : c.owner === "human" ? `the human's own ${c.kind}` : `a promise agent @${c.owner} made to the human`,
    certainty: c.certainty,
    due: c.due === undefined ? "none" : c.due <= now ? `${span(now - c.due)} ago` : `in ${span(c.due - now)}`,
    last_mentioned: ago(c.lastSeen, now),
    raised_before: c.surfaced,
    human_let_pass: c.ignored - i.skipped,
    agent_declined_before: i.skipped,
  }
}

const answer = (loop: string, room: string, messageId: string, at: number): Signal => ({ kind: "answer", id: `answer:${loop}:${room}:${messageId}`, room, at, loop })

const loopIdOf = (id: string): number | null => (id.startsWith("loop:") ? Number(id.slice(5)) : null)

export const day = (at: number, tz: string) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz })
const localNow = (now: number, tz: string) => new Date(now).toLocaleString("en-US", { timeZone: tz, weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })

function span(ms: number): string {
  const h = Math.round(ms / 3_600_000)
  return h < 36 ? `${Math.max(1, h)} hours` : `${Math.round(h / 24)} days`
}

const ago = (at: number, now: number) => (now - at < 3_600_000 ? "just now" : `${span(now - at)} ago`)
