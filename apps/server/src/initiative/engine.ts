import type { Judge } from "@yuki/memory/judge"
import { keywords } from "@yuki/memory/life"
import { type Loops, loopLine } from "@yuki/memory/loops"
import type { AgentSlug } from "@yuki/protocol"
import type { SignalBatch } from "../room/signals"
import type { WakeResult } from "../room/wake"
import type { ChatTasks } from "../user/overview"
import type { Reminder, RoutineRun } from "../user/reminders"
import { allowance, type Outcome, restUntil } from "./attention/appetite"
import { attend, score } from "./attention/attend"
import { decayed, emptyRhythm, known, nextMoment, slotOf, view } from "./attention/rhythm"
import { AttentionStore } from "./attention/store"
import { getSetting, setSetting } from "../lib/settings"
import type { Candidate, Kind, Level, Signal, Verdict } from "./attention/types"
import { type WorthItem, worthNow } from "./judge"

// Architecture section 26.6. The initiative engine in `UserDO`: it reads the signal bus into the
// attention store, gathers candidates (open loops, stalled tasks, routines in trouble), and once a
// day at the human's own next moment runs `attend`. A nudge is one wake through
// `RoomDO.initiativeWake` to the owner of the item or the room's lead, about one item. Everything
// else stays in the brief. A wake the agent answers with [skip] is an outcome like an ignore.

/** The routine ids under which the room follows initiative and reminder runs (room-do.ts). */
export const INITIATIVE_RUN = "initiative"
export const REMINDER_RUN = "reminder"
export const INITIATIVE_WAKEUP = "initiative_pass"

/** A pass runs at most once in this long. ASSUMPTION: a little under a day, so a daily moment that drifts is kept. */
const MIN_GAP = 20 * 3_600_000
/** Jev reads at most this many candidates a pass. */
const JEV_MAX = 10
/** The human counts as busy in a room this long after they wrote there. The room also steps back while they type. */
const BUSY_MS = 120_000
const NOTICED_MAX = 2
/** Without a judge, a burst that shares this many words with an open loop keeps it fresh. */
const SHARED_WORDS = 2
const LAST_PASS = "initiative_last_pass"
/** The room resolves this to its lead. */
const LEAD = "@lead"

export type WakeInput = { id: string; to: AgentSlug | null; body: string; reason: string; tainted: boolean }

export type EngineDeps = {
  sql: SqlStorage
  loops: Loops
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
  count: (delta: Record<string, number>) => void
  setWakeup: (at: number) => Promise<void>
  clearWakeup: () => Promise<void>
}

/** One candidate with the words the agent and the human read. */
type Item = { c: Candidate; text: string; line: string; reason: string; skipped: number; loopId?: number }

/** What happened to one item: nudges that reached the human, ones they let pass, wakes the agent declined. */
type Mark = { surfaced: number; ignored: number; skipped: number; last_at: number | null }

export type PassReport = {
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
    const { sql } = d
    sql.exec("CREATE TABLE IF NOT EXISTS initiative_marks (id TEXT PRIMARY KEY, surfaced INTEGER NOT NULL DEFAULT 0, ignored INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0, last_at INTEGER)")
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
    const heard: Signal[] = []
    for (const s of batch.signals) {
      if (s.kind === "routine_result" && s.routineId === INITIATIVE_RUN) this.ran(s.occurrence, s.outcome, now)
      else if (s.kind === "routine_result" && s.routineId === REMINDER_RUN && s.outcome === "ok") this.kept(s.occurrence, now)
      else if (s.kind === "burst" && s.by.kind === "human") {
        heard.push({ kind: "burst", id: `burst:${s.roomId}:${s.seq}`, room: s.roomId, at: s.at })
        this.d.sql.exec("INSERT INTO initiative_rooms (room_id, human_at) VALUES (?, ?) ON CONFLICT(room_id) DO UPDATE SET human_at = max(human_at, excluded.human_at)", s.roomId, s.at)
        // The human talking about a loop again keeps it fresh. Shared words only bump it; closing is the judge's or the agent's.
        if (this.d.title(s.roomId) !== null) {
          const said = new Set(keywords(s.text))
          for (const l of this.d.loops.similar(s.text, 2)) if (keywords(l.text).filter((w) => said.has(w)).length >= SHARED_WORDS) this.d.loops.touch(l.id, s.at)
        }
      } else if (s.kind === "task") heard.push({ kind: "task", id: `task:${s.roomId}:${s.seq}`, room: s.roomId, at: s.at, by: s.by?.kind === "agent" ? s.by.slug : "human" })
    }
    this.apply(this.store.observe(heard, now, this.d.tz()))
    await this.arm(now)
  }

  /** Loop `id` was closed as dropped. A nudge about it still in its window counts as dismissed, even after a reply. */
  dropped(id: number, now = Date.now()): void {
    const loop = `loop:${id}`
    const pending = this.store.appetite().pending.find((p) => p.loop === loop)
    if (pending) this.apply(this.store.observe([{ kind: "dismiss", id: `dismiss:${loop}:${now}`, room: pending.room, at: now, loop }], now, this.d.tz()))
  }

  /**
   * The wake's run ended. A run that posted is a nudge sent. [skip] is the agent judging it not worth
   * it: the item rests as after an ignore and the kind's appetite learns it. A failed run only rests.
   */
  private ran(wakeId: string, outcome: string, now: number): void {
    const row = this.d.sql.exec<{ room: string; slug: string; kind: string; ids: string; status: string }>("SELECT * FROM initiative_wakes WHERE id = ?", wakeId).toArray()[0]
    if (!row || row.status !== "pending") return
    const id = (JSON.parse(row.ids) as string[])[0]!
    const kind = row.kind as Kind
    const status = outcome === "ok" ? "spoke" : outcome === "quiet" ? "skipped" : "failed"
    this.d.sql.exec("UPDATE initiative_wakes SET status = ? WHERE id = ?", status, wakeId)
    this.mark(id, status === "spoke" ? "surfaced" : status === "skipped" ? "skipped" : null, now)
    if (status === "spoke") {
      this.store.sent({ id: wakeId, room: row.room, kind, loop: id, at: now }, this.d.tz())
      const loop = loopIdOf(id)
      // The owner was woken for its own promise and spoke: it kept it, or said why it cannot. Either way it is not owed again.
      if (loop !== null && row.slug !== LEAD && this.d.loops.get(loop)?.owner === row.slug) this.d.loops.close(loop, "done", now)
    } else if (status === "skipped") this.store.skipped(kind, now)
    this.d.count({ [`initiative_${status}`]: 1 })
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
      if (o.result === "ignored") this.mark(o.nudge.loop, "ignored", null)
      else if (o.result === "dismissed") {
        const loop = loopIdOf(o.nudge.loop)
        if (loop !== null) this.d.loops.close(loop, "dropped", o.at)
      }
      this.d.count({ [`initiative_${o.result}`]: 1 })
    }
  }

  /** Counts one outcome for an item. `at` restarts its rest; a null field only restarts it. */
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

  /** Everything that could deserve attention now, with the words for it. */
  private items(now: number, cycle: number): Item[] {
    const tz = this.d.tz()
    const marks = new Map(this.d.sql.exec<Mark & { id: string }>("SELECT * FROM initiative_marks").toArray().map((m) => [m.id, m]))
    const out: Item[] = []
    const home = this.d.home()
    const add = (id: string, c: Omit<Candidate, "id" | "surfaced" | "ignored" | "lastSurfaced">, rest: Omit<Item, "c" | "skipped">) => {
      const m = marks.get(id)
      out.push({ c: { ...c, id, surfaced: m?.surfaced ?? 0, ignored: (m?.ignored ?? 0) + (m?.skipped ?? 0), ...(m?.last_at ? { lastSurfaced: m.last_at } : {}) }, skipped: m?.skipped ?? 0, ...rest })
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
          { text: t.title, line: `task ${t.id} "${t.title}" is ${t.status}${t.owner ? `, owner @${t.owner}` : ""}, untouched ${ago(t.updatedAt, now)}`, reason: `Untouched for ${span(now - t.updatedAt)}` },
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
    return Number(getSetting(this.d.sql, LAST_PASS) ?? 0)
  }

  /**
   * Sets the pass for the human's next moment, at least `MIN_GAP` after the last. Nothing is set while
   * initiative is off or in chat only, while the rhythm is unknown, or when there is no candidate: then
   * the brief is the only channel and costs nothing.
   */
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

  /** One attention pass. The alarm calls it at the moment `arm` picked; a development route calls it any time. */
  async pass(now = Date.now()): Promise<PassReport> {
    const tz = this.d.tz()
    const store = this.store
    this.apply(store.observe([], now, tz))
    setSetting(this.d.sql, LAST_PASS, String(now))
    const rhythm = view(store.rhythm(), now, tz)
    const items = this.items(now, rhythm.cycle)
    const report: PassReport = { at: now, rhythm: { known: rhythm.known, activeNow: rhythm.activeNow, cycle: rhythm.cycle }, jev: false, verdicts: [], woke: [] }
    const level = this.d.level()
    const appetite = store.appetite()
    const busyRooms = this.d.sql.exec<{ room_id: string }>("SELECT room_id FROM initiative_rooms WHERE human_at > ?", now - BUSY_MS).toArray().map((r) => r.room_id)
    const away = this.d.away()
    const budget = this.d.budget()
    const ctx = { now, level, away, budget, busyRooms, leads: Object.fromEntries(items.map((i) => [i.c.room, LEAD])), rhythm, appetite }
    let worth: Record<string, number> | null = null
    const judge = this.d.judge()
    // Jev is asked only when a nudge could go out at all, and only about what is past its rest. Its answer gates every wake.
    if (judge && items.length && (level === "digest" || level === "active") && rhythm.known && rhythm.activeNow && !away && budget > 0 && allowance(appetite, now) > 0) {
      const eligible = items
        .filter((i) => now >= restUntil(appetite, i.c, rhythm.cycle, now) && !busyRooms.includes(i.c.room))
        .sort((a, b) => score(b.c, ctx) - score(a.c, ctx))
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
    report.verdicts = verdicts.map((v) => ({ ...v, text: byId.get(v.id)!.text }))
    for (const v of verdicts) {
      if (v.verdict !== "nudge") continue
      const item = byId.get(v.id)!
      const own = item.c.owner !== "human"
      const slug = own ? v.target.slug : LEAD
      // Named by the item and its history, so a retried pass wakes once and a later nudge is a new wake.
      const id = `${item.c.id}#${item.c.lastSurfaced ?? 0}`
      const result = await this.d.wake(item.c.room, { id, to: own ? (slug as AgentSlug) : null, body: wakeBody(item, own), reason: item.reason, tainted: item.c.tainted })
      if (result === "delivered") {
        this.d.sql.exec("INSERT OR IGNORE INTO initiative_wakes (id, room, slug, kind, ids, at, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')", id, item.c.room, slug, item.c.kind, JSON.stringify([item.c.id]), now)
        this.d.count({ initiative_woke: 1 })
      }
      report.woke.push({ id, room: item.c.room, to: own ? slug : "lead", result, ids: [item.c.id] })
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
    const rhythm = view(this.store.rhythm(), now, this.d.tz())
    const appetite = this.store.appetite()
    return this.items(now, rhythm.cycle)
      .filter((i) => i.loopId !== undefined && i.c.owner === "human" && i.c.room === roomId && !skip.has(i.loopId) && now >= restUntil(appetite, i.c, rhythm.cycle, now))
      .map((i) => ({ i, s: score(i.c, { now, rhythm }) }))
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
    setSetting(this.d.sql, LAST_PASS, String(this.lastPass() - ms))
    this.store.devShift(ms)
  }

  /** `now`: the human writes every day at this hour, so the pass may speak now. `clear`: no rhythm. */
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

/** What a woken agent is told to do, and what Jev reads as the agent's instructions. */
const NUDGE_RULE = "one short message in your own words, at most two sentences, that asks. no text around tool calls. reply only [skip] when this chat shows it is already handled."

const ASK_FIRST = "nobody asked yet, so ask first: no file, task, reminder, or routine until the human says yes."

/** The wake: one item, why now, and one short message. */
function wakeBody(i: Item, own: boolean): string {
  if (own && i.loopId !== undefined) {
    return [
      `initiative: you promised this and it is still open: ${i.line}.`,
      "keep it now in one short message: the result, or one line on why you cannot. no text around tool calls.",
      `then close L${i.loopId} done with the loop tool. if this chat shows it was already kept, close it and reply only [skip].`,
    ].join("\n")
  }
  if (own) return [`initiative: your ${i.line}.`, `tell the human where it stands or what is in the way, and ask whether to go on: ${NUDGE_RULE}`, ASK_FIRST].join("\n")
  return [
    `initiative: the human usually writes around now, and this looks worth raising:\n- ${i.line}`,
    `raise it now: ${NUDGE_RULE} if it is a teammate's work, ask that teammate with send_message instead.`,
    ASK_FIRST,
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

const loopIdOf = (id: string): number | null => (id.startsWith("loop:") ? Number(id.slice(5)) : null)

const day = (at: number, tz: string) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: tz })
const localNow = (now: number, tz: string) => new Date(now).toLocaleString("en-US", { timeZone: tz, weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })

function span(ms: number): string {
  const h = Math.round(ms / 3_600_000)
  return h < 36 ? `${Math.max(1, h)} hours` : `${Math.round(h / 24)} days`
}

const ago = (at: number, now: number) => (now - at < 3_600_000 ? "just now" : `${span(now - at)} ago`)
