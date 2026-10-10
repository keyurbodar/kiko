import type { Judge } from "@yuki/memory/judge"
import { type Loops, loopLine } from "@yuki/memory/loops"
import type { AgentSlug } from "@yuki/protocol"
import type { WakeResult } from "../room/wake"
import type { SignalBatch } from "../room/signals"
import type { ChatTasks } from "../user/overview"
import type { Reminder, RoutineRun } from "../user/reminders"
import { allowance, type Outcome, restUntil } from "./attention/appetite"
import { attend, score } from "./attention/attend"
import { decayed, emptyRhythm, known, nextMoment, slotOf, view } from "./attention/rhythm"
import type { AttentionStore } from "./attention/store"
import type { Candidate, Level, Signal, Verdict } from "./attention/types"
import { judged, type WorthItem } from "./judge"

// Architecture section 26.6. The initiative engine in `UserDO`: it reads the signal bus into the
// attention store and the loops, gathers candidates (open loops, stalled tasks, routines in trouble),
// and once a day at the human's own next moment runs `attend`. A nudge is one wake through
// `RoomDO.initiativeWake` to the room's lead, or to the agent that owns the item. The agent may
// answer [skip]; only a run that spoke counts as a nudge sent. Everything else stays in the brief.

/** The routine ids under which the room follows initiative and reminder runs (room-do.ts). */
export const INITIATIVE_RUN = "initiative"
export const REMINDER_RUN = "reminder"
export const INITIATIVE_WAKEUP = "initiative_pass"

/** A pass runs at most once in this long. ASSUMPTION: a little under a day, so a daily moment that drifts is kept. */
const MIN_GAP = 20 * 3_600_000
/** The human counts as busy in a room this long after they wrote there. */
const BUSY_MS = 120_000
/** Jev reads at most this many candidates a pass. */
const JEV_MAX = 10
/** A lead's shortlist holds the main item and at most this many more. */
const SHORTLIST_MORE = 2
const NOTICED_MAX = 2
const LAST_PASS = "initiative_last_pass"
/** The room resolves this to its lead. */
const LEAD = "@lead"

export type WakeInput = { id: string; to: AgentSlug | null; body: string; reason: string; tainted: boolean }

export type EngineDeps = {
  sql: SqlStorage
  loops: Loops
  store: AttentionStore
  tz: () => string
  level: () => Level
  away: () => boolean
  /** Runs nobody asked for that the user's budget still allows today. */
  budget: () => number
  /** The chat's title, or null for a private, temporary, or missing chat. */
  title: (roomId: string) => string | null
  /** The yuki chat, home of loops that belong to no chat. */
  home: () => string | null
  routines: () => { routine: Reminder; last: RoutineRun | null }[]
  judge: () => Judge | null
  wake: (roomId: string, input: WakeInput) => Promise<WakeResult | "busy">
  setting: (key: string) => string | null
  putSetting: (key: string, value: string) => void
  count: (delta: Record<string, number>) => void
  setWakeup: (at: number) => Promise<void>
  clearWakeup: () => Promise<void>
}

/** One candidate with the words the agent and the human read. */
type Item = { c: Candidate; text: string; line: string; reason: string; loopId?: number; taskId?: string }

type Mark = { surfaced: number; ignored: number; skipped: number; dismissed: number; last_at: number | null }

export type PassReport = {
  at: number
  rhythm: { known: boolean; activeNow: boolean; cycle: number }
  jev: boolean
  verdicts: (Verdict & { text: string })[]
  woke: { id: string; room: string; to: string; result: WakeResult | "busy"; ids: string[] }[]
}

export class InitiativeEngine {
  constructor(private readonly d: EngineDeps) {
    const { sql } = d
    sql.exec("CREATE TABLE IF NOT EXISTS initiative_marks (id TEXT PRIMARY KEY, surfaced INTEGER NOT NULL DEFAULT 0, ignored INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0, dismissed INTEGER NOT NULL DEFAULT 0, last_at INTEGER)")
    sql.exec("CREATE TABLE IF NOT EXISTS initiative_wakes (id TEXT PRIMARY KEY, room TEXT NOT NULL, slug TEXT NOT NULL, kind TEXT NOT NULL, ids TEXT NOT NULL, at INTEGER NOT NULL, status TEXT NOT NULL)")
    sql.exec("CREATE TABLE IF NOT EXISTS initiative_rooms (room_id TEXT PRIMARY KEY, human_at INTEGER NOT NULL)")
    sql.exec("CREATE TABLE IF NOT EXISTS loop_reminders (reminder_id TEXT PRIMARY KEY, loop_id INTEGER NOT NULL)")
  }

  /** A reminder an agent set for itself keeps loop `loopId`: while it is active the loop is not a candidate. */
  link(reminderId: string, loopId: number): void {
    this.d.sql.exec("INSERT OR REPLACE INTO loop_reminders (reminder_id, loop_id) VALUES (?, ?)", reminderId, loopId)
  }

  /** One batch from the bus: the human's rhythm, nudge outcomes, kept promises, and loops talked about again. */
  async signals(batch: SignalBatch, now = Date.now()): Promise<void> {
    const tz = this.d.tz()
    const heard: Signal[] = []
    for (const s of batch.signals) {
      if (s.kind === "routine_result" && s.routineId === INITIATIVE_RUN) this.ran(s.occurrence, s.outcome, now)
      else if (s.kind === "routine_result" && s.routineId === REMINDER_RUN && s.outcome === "ok") this.kept(s.occurrence, now)
      else if (s.kind === "burst" && s.by.kind === "human") {
        heard.push({ kind: "burst", id: `burst:${s.roomId}:${s.seq}`, room: s.roomId, at: s.at, from: "human" })
        this.d.sql.exec("INSERT INTO initiative_rooms (room_id, human_at) VALUES (?, ?) ON CONFLICT(room_id) DO UPDATE SET human_at = max(human_at, excluded.human_at)", s.roomId, s.at)
        // The human talking about a loop again keeps it fresh. Shared words only bump it; closing is the judge's or the agent's.
        if (this.d.title(s.roomId) !== null) for (const l of this.d.loops.similar(s.text, 2)) if (sharedWords(l.text, s.text) >= 2) this.d.loops.touch(l.id, s.at)
      } else if (s.kind === "task") heard.push({ kind: "task", id: `task:${s.roomId}:${s.seq}`, room: s.roomId, at: s.at, by: s.by?.kind === "agent" ? s.by.slug : "human" })
    }
    this.apply(this.d.store.observe(heard, now, tz))
    await this.arm(now)
  }

  /** The human or an agent dropped loop `id`. A nudge about it waiting for its outcome counts as dismissed. */
  dropped(id: number, now = Date.now()): void {
    const key = `loop:${id}`
    const pending = this.d.store.appetite().pending.find((p) => p.loop === key)
    if (!pending) return
    this.apply(this.d.store.observe([{ kind: "dismiss", id: `dismiss:${key}:${now}`, room: pending.room, at: now, loop: key }], now, this.d.tz()))
  }

  /** The wake's run ended. Only a run that posted is a nudge; [skip] rests the items like a nudge without teaching the appetite. */
  private ran(wakeId: string, outcome: string, now: number): void {
    const row = this.d.sql.exec<{ room: string; slug: string; kind: string; ids: string; at: number; status: string }>("SELECT * FROM initiative_wakes WHERE id = ?", wakeId).toArray()[0]
    if (!row || row.status !== "pending") return
    const ids = JSON.parse(row.ids) as string[]
    // A run that failed rests the items like a [skip], so the next pass asks again later, under a new id.
    const status = outcome === "ok" ? "spoke" : "skipped"
    this.d.sql.exec("UPDATE initiative_wakes SET status = ? WHERE id = ?", status, wakeId)
    for (const id of ids) {
      this.mark(id, status === "spoke" ? "surfaced" : "skipped", now)
      const loop = loopIdOf(id)
      if (loop === null || status !== "spoke") continue
      this.d.loops.surfaced(loop)
      // The owner was woken for its own promise and spoke: it kept it, or said why it cannot. Either way it is not owed again.
      if (row.slug !== LEAD && this.d.loops.get(loop)?.owner === row.slug) this.d.loops.close(loop, "done", now)
    }
    if (status === "spoke") this.d.store.sent({ id: wakeId, room: row.room, kind: row.kind as Candidate["kind"], loop: ids[0]!, at: now }, this.d.tz())
    this.d.count(status === "spoke" ? { initiative_spoke: 1 } : { initiative_skipped: 1 })
  }

  /** A reminder an agent set for itself fired and the agent posted: its promise is kept. */
  private kept(reminderId: string, now: number): void {
    for (const r of this.d.sql.exec<{ loop_id: number }>("SELECT loop_id FROM loop_reminders WHERE reminder_id = ?", reminderId).toArray()) {
      if (this.d.loops.close(r.loop_id, "done", now)) this.d.count({ loops_closed: 1 })
    }
    this.d.sql.exec("DELETE FROM loop_reminders WHERE reminder_id = ?", reminderId)
  }

  private apply(outcomes: Outcome[]): void {
    for (const o of outcomes) {
      const loop = loopIdOf(o.nudge.loop)
      if (o.result === "ignored") {
        this.mark(o.nudge.loop, "ignored", o.at)
        if (loop !== null) this.d.loops.ignored(loop)
      } else if (o.result === "dismissed") {
        this.mark(o.nudge.loop, "dismissed", o.at)
        if (loop !== null) this.d.loops.close(loop, "dropped", o.at)
      }
      this.d.count({ [`initiative_${o.result}`]: 1 })
    }
  }

  private mark(id: string, field: "surfaced" | "ignored" | "skipped" | "dismissed", at: number): void {
    const stamp = field === "surfaced" || field === "skipped"
    this.d.sql.exec(
      `INSERT INTO initiative_marks (id, ${field}, last_at) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET ${field} = ${field} + 1${stamp ? ", last_at = excluded.last_at" : ""}`,
      id,
      stamp ? at : null,
    )
  }

  private marks(): Map<string, Mark> {
    return new Map(this.d.sql.exec<Mark & { id: string }>("SELECT * FROM initiative_marks").toArray().map((m) => [m.id, m]))
  }

  /** Everything that could deserve attention now, with the words for it. */
  private items(now: number, cycle: number): Item[] {
    const tz = this.d.tz()
    const marks = this.marks()
    const out: Item[] = []
    const home = this.d.home()
    const add = (id: string, c: Omit<Candidate, "id" | "surfaced" | "ignored" | "lastSurfaced">, rest: Omit<Item, "c">) => {
      const m = marks.get(id)
      if (m?.dismissed) return
      out.push({ c: { ...c, id, surfaced: m?.surfaced ?? 0, ignored: (m?.ignored ?? 0) + (m?.skipped ?? 0), ...(m?.last_at ? { lastSurfaced: m.last_at } : {}) }, ...rest })
    }
    const kept = new Set(
      this.d.sql
        .exec<{ loop_id: number }>("SELECT loop_id FROM loop_reminders WHERE reminder_id IN (SELECT id FROM reminders WHERE status = 'active')")
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
        { kind: l.kind, certainty: l.certainty, owner: l.owner, room, ...(due !== undefined && !Number.isNaN(due) ? { due } : {}), mentions: l.mentions, lastSeen: l.lastSeen, tainted: l.tainted },
        { text: l.text, line: `${loopLine(l)} (${said} ${day(l.openedAt, tz)}, last mentioned ${ago(l.lastSeen, now)})`, reason: l.owner === "human" ? `You mentioned this ${day(l.openedAt, tz)}` : `Promised ${day(l.openedAt, tz)}`, loopId: l.id },
      )
    }
    for (const r of this.d.sql.exec<{ room_id: string; tasks: string }>("SELECT room_id, tasks FROM chat_tasks").toArray()) {
      if (this.d.title(r.room_id) === null) continue
      for (const t of (JSON.parse(r.tasks) as ChatTasks).oldest) {
        // A task is stalled when nobody touched it for one of the human's own cycles.
        if (!t.id || !["doing", "blocked", "review"].includes(t.status) || now - t.updatedAt < cycle) continue
        const owner = t.status === "review" || !t.owner ? "human" : t.owner
        add(
          `task:${r.room_id}:${t.id}:${t.updatedAt}`,
          { kind: "task", certainty: "explicit", owner, room: r.room_id, due: t.updatedAt + cycle, mentions: 1, lastSeen: t.updatedAt, tainted: false },
          { text: t.title, line: `task ${t.id} "${t.title}" is ${t.status}${t.owner ? `, owner @${t.owner}` : ""}, untouched ${ago(t.updatedAt, now)}`, reason: `Untouched for ${span(now - t.updatedAt)}`, taskId: t.id },
        )
      }
    }
    for (const { routine, last } of this.d.routines()) {
      const failed = last?.status === "failed" || last?.status === "timeout"
      if (!routine.trigger || !(routine.status === "paused" || (routine.status === "active" && failed)) || this.d.title(routine.roomId) === null) continue
      const at = last?.startedAt ?? now
      const what = routine.status === "paused" ? "is paused" : `last run ${last!.status} ${ago(at, now)}`
      add(
        `routine:${routine.id}:${last?.occurrence ?? routine.status}`,
        { kind: "routine", certainty: "explicit", owner: "human", room: routine.roomId, due: at, mentions: 1, lastSeen: at, tainted: routine.tainted },
        { text: routine.name ?? "a routine", line: `routine "${routine.name ?? routine.id}" (${routine.id}) ${what}`, reason: routine.status === "paused" ? "A routine paused" : "A routine failed" },
      )
    }
    return out
  }

  private lastPass(): number {
    return Number(this.d.setting(LAST_PASS) ?? 0)
  }

  /**
   * Sets the pass for the human's next moment, at least `MIN_GAP` after the last. Nothing is set while
   * initiative is off or in chat only, while the rhythm is unknown, or when there is no candidate: then
   * the brief is the only channel and costs nothing.
   */
  async arm(now = Date.now()): Promise<number | null> {
    const level = this.d.level()
    const rhythm = decayed(this.d.store.rhythm(), now)
    if (level === "off" || level === "chat" || !known(rhythm) || !this.items(now, view(rhythm, now, this.d.tz()).cycle).length) {
      await this.d.clearWakeup()
      return null
    }
    const at = nextMoment(rhythm, Math.max(now, this.lastPass() + MIN_GAP), this.d.tz())
    if (at === null) await this.d.clearWakeup()
    else await this.d.setWakeup(at)
    return at
  }

  /** One attention pass. The alarm calls it at the moment `arm` picked; a development route calls it any time. */
  async pass(now = Date.now()): Promise<PassReport> {
    const tz = this.d.tz()
    const store = this.d.store
    this.apply(store.observe([], now, tz))
    this.d.putSetting(LAST_PASS, String(now))
    const rhythm = view(store.rhythm(), now, tz)
    const items = this.items(now, rhythm.cycle)
    const report: PassReport = { at: now, rhythm: { known: rhythm.known, activeNow: rhythm.activeNow, cycle: rhythm.cycle }, jev: false, verdicts: [], woke: [] }
    if (!items.length) {
      await this.arm(now)
      return report
    }
    const level = this.d.level()
    const appetite = store.appetite()
    const busyRooms = this.d.sql.exec<{ room_id: string }>("SELECT room_id FROM initiative_rooms WHERE human_at > ?", now - BUSY_MS).toArray().map((r) => r.room_id)
    const leads = Object.fromEntries(items.map((i) => [i.c.room, LEAD]))
    const away = this.d.away()
    const budget = this.d.budget()
    const ctx = { now, level, away, budget, busyRooms, leads, rhythm, appetite }
    let worthNow: Record<string, number> | undefined
    const judge = this.d.judge()
    // Jev is asked only when a nudge could go out at all, and only about what is past its rest.
    if (judge && (level === "digest" || level === "active") && rhythm.known && rhythm.activeNow && !away && budget > 0 && allowance(appetite, now) > 0) {
      const eligible = items
        .filter((i) => now >= restUntil(appetite, i.c, rhythm.cycle, now) && !busyRooms.includes(i.c.room))
        .sort((a, b) => score(b.c, ctx) - score(a.c, ctx))
        .slice(0, JEV_MAX)
      if (eligible.length) {
        const worth = await judged(judge, (j) => j.worthNow(eligible.map((i) => worthItem(i)), { now: localNow(now, tz), human_usually_writes_now: true }))
        if (worth !== "unknown") {
          worthNow = Object.fromEntries(worth.map((w) => [w.id, w.p]))
          report.jev = true
          this.d.count({ initiative_jev: 1 })
        }
      }
    }
    const verdicts = attend(
      items.map((i) => i.c),
      { ...ctx, ...(worthNow ? { worthNow } : {}) },
    )
    const byId = new Map(items.map((i) => [i.c.id, i]))
    report.verdicts = verdicts.map((v) => ({ ...v, text: byId.get(v.id)!.text }))
    for (const v of verdicts) {
      if (v.verdict !== "nudge" && v.verdict !== "ask_lead" && v.verdict !== "prepare") continue
      const main = byId.get(v.id)!
      const own = main.c.owner !== "human" && v.target.slug !== LEAD
      // A lead with no judge gets the shortlist of what else in the room was worth it, and picks or skips.
      const more = own
        ? []
        : verdicts
            .filter((x): x is Extract<Verdict, { verdict: "brief" }> => x.verdict === "brief" && (x.reason === "room_taken" || x.reason === "allowance") && byId.get(x.id)!.c.room === main.c.room && byId.get(x.id)!.c.owner === "human")
            .sort((a, b) => b.score - a.score)
            .slice(0, SHORTLIST_MORE)
            .map((x) => byId.get(x.id)!)
      const list = [main, ...more]
      // Named by the item and its history, so a retried pass wakes once, and a new nudge after an outcome gets a new id.
      const id = `${main.c.id}#${main.c.surfaced}.${main.c.ignored}`
      const result = await this.d.wake(main.c.room, { id, to: own ? (v.target.slug as AgentSlug) : null, body: own ? ownBody(main) : leadBody(list, v.verdict === "nudge"), reason: main.reason, tainted: list.some((i) => i.c.tainted) })
      if (result === "delivered") {
        this.d.sql.exec("INSERT OR IGNORE INTO initiative_wakes (id, room, slug, kind, ids, at, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')", id, main.c.room, own ? v.target.slug : LEAD, main.c.kind, JSON.stringify(list.map((i) => i.c.id)), now)
        this.d.count({ initiative_woke: 1 })
      }
      report.woke.push({ id, room: main.c.room, to: own ? v.target.slug : "lead", result, ids: list.map((i) => i.c.id) })
    }
    await this.arm(now)
    return report
  }

  /**
   * The brief channel: at most two of the human's open loops in this chat (or, in the yuki chat, loops
   * of no chat), past their rest, most pressing first. The agent decides whether to bring one up.
   */
  noticed(roomId: string, skip: ReadonlySet<number>, now = Date.now()): string[] {
    if (this.d.level() === "off") return []
    const tz = this.d.tz()
    const store = this.d.store
    const rhythm = view(store.rhythm(), now, tz)
    const appetite = store.appetite()
    const ctx = { now, level: this.d.level(), away: false, budget: 0, busyRooms: [], leads: {}, rhythm, appetite }
    return this.items(now, rhythm.cycle)
      .filter((i) => i.loopId !== undefined && i.c.owner === "human" && i.c.room === roomId && !skip.has(i.loopId) && now >= restUntil(appetite, i.c, rhythm.cycle, now))
      .map((i) => ({ i, s: score(i.c, ctx) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, NOTICED_MAX)
      .map(({ i }) => i.line)
  }

  // Development only (section 26.8): time travel and a known rhythm, so a suite can prove a day in seconds.

  /** Moves the engine's clock state `ms` into the past: loops, marks, waits, the last pass, pending nudges. */
  devAge(ms: number): void {
    const { sql } = this.d
    sql.exec("UPDATE loops SET opened_at = opened_at - ?, last_seen = last_seen - ?, snoozed_until = snoozed_until - ?", ms, ms, ms)
    for (const r of sql.exec<{ id: number; due: string }>("SELECT id, due FROM loops WHERE due IS NOT NULL").toArray()) {
      const at = Date.parse(r.due)
      if (!Number.isNaN(at)) sql.exec("UPDATE loops SET due = ? WHERE id = ?", new Date(at - ms).toISOString(), r.id)
    }
    sql.exec("UPDATE initiative_marks SET last_at = last_at - ?", ms)
    sql.exec("UPDATE initiative_wakes SET at = at - ?", ms)
    sql.exec("UPDATE initiative_rooms SET human_at = human_at - ?", ms)
    this.d.putSetting(LAST_PASS, String(this.lastPass() - ms))
    this.d.store.devShift(ms)
  }

  /** `now`: the human writes every day at this hour, so the pass may speak now. `clear`: no rhythm. */
  devRhythm(mode: "now" | "clear", now = Date.now()): void {
    const r = emptyRhythm()
    if (mode === "now") {
      const hour = slotOf(now, this.d.tz()) % 24
      for (let d = 0; d < 7; d++) r.w[d * 24 + hour] = 2
      r.at = now
    }
    this.d.store.devRhythm(r)
  }

  devState(): { rhythm: ReturnType<typeof view>; appetite: ReturnType<AttentionStore["appetite"]>; marks: (Mark & { id: string })[]; wakes: unknown[] } {
    const now = Date.now()
    return {
      rhythm: view(this.d.store.rhythm(), now, this.d.tz()),
      appetite: this.d.store.appetite(),
      marks: this.d.sql.exec<Mark & { id: string }>("SELECT * FROM initiative_marks").toArray(),
      wakes: this.d.sql.exec("SELECT * FROM initiative_wakes ORDER BY at").toArray(),
    }
  }
}

const RULES = [
  "nobody asked for this. if it is not worth raising right now, reply only [skip]. silence is fine and usual.",
  "if it is worth it: one short message in your own words, at most two sentences, ending with a question. ask, don't schedule: no reminder, routine, or task unless the human says yes.",
  "if it is a teammate's work, message that teammate with send_message instead of the human.",
  "if the human says they no longer want something, close its loop as dropped with the loop tool.",
].join("\n")

function leadBody(list: readonly Item[], judged: boolean): string {
  return [
    `initiative: the human usually writes around now.${judged ? " this one looked worth raising." : " decide if one of these is worth raising; at most one."}`,
    ...list.map((i) => `- ${i.line}`),
    RULES,
  ].join("\n")
}

function ownBody(i: Item): string {
  if (i.c.kind === "task") return [`initiative: your ${i.line}.`, "move it forward, or tell the human in one line what is in the way. if it is fine as it is, reply only [skip]."].join("\n")
  return [
    `initiative: you promised this and it is still open: ${i.line}.`,
    `keep it now: do the work and post the result in one short message, or say in one line why you cannot. then close L${i.loopId} done with the loop tool. if it was already kept, close L${i.loopId} done and reply only [skip].`,
    "ask, don't schedule: no reminder or routine unless the human says yes.",
  ].join("\n")
}

function worthItem(i: Item): WorthItem {
  return { id: i.c.id, text: i.text, kind: i.c.kind, certainty: i.c.certainty, owner: i.c.owner, due: i.c.due ? new Date(i.c.due).toISOString() : null, lastSeen: i.c.lastSeen, surfaced: i.c.surfaced, ignored: i.c.ignored }
}

const loopIdOf = (id: string): number | null => (id.startsWith("loop:") ? Number(id.slice(5)) : null)

function sharedWords(a: string, b: string): number {
  const words = (t: string) => new Set(t.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])
  const mine = words(b)
  return [...words(a)].filter((w) => mine.has(w)).length
}

const day = (at: number, tz: string) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz })
const localNow = (now: number, tz: string) => new Date(now).toLocaleString("en-US", { timeZone: tz, weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })

function span(ms: number): string {
  const h = Math.round(ms / 3_600_000)
  return h < 36 ? `${Math.max(1, h)} hours` : `${Math.round(h / 24)} days`
}

const ago = (at: number, now: number) => (now - at < 3_600_000 ? "just now" : `${span(now - at)} ago`)
