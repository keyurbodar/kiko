import { type Loop, type Loops, loopLine } from "@kiko/memory/loops"
import type { AgentSlug } from "@kiko/protocol"
import type { UserSettings } from "@kiko/protocol/schema"
import { nextOccurrence, validZone } from "@kiko/sandbox/recurrence"
import { getSetting, setSetting } from "../lib/settings"
import type { SignalBatch } from "../room/signals"
import type { WakeResult } from "../room/wake"

export const INITIATIVE_RUN = "initiative"
export const REMINDER_RUN = "reminder"
export const INITIATIVE_WAKEUP = "initiative_pass"

const DAILY_AT_NINE = "FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0"
const HOUR = 3_600_000
const DAY = 24 * HOUR
const RENUDGE_MS = 3 * DAY
const STALE_MS = 30 * DAY
const KEEP_MS = 90 * DAY
const TRIES = 5
const PER_PASS = { digest: 1, active: 3 }
const NOTICED_MAX = 2
export const SHARED_WORDS = 2
const RETRY_AT = "initiative_retry_at"
const REMINDER_RUN_WINDOW = HOUR

export type Level = UserSettings["initiative"]

export type WakeInput = { id: string; to: AgentSlug | null; body: string; reason: string }

type EngineDeps = {
  sql: SqlStorage
  loops: Loops
  tz: () => string
  level: () => Level
  title: (roomId: string) => string | null
  home: () => string | null
  wake: (roomId: string, input: WakeInput) => Promise<WakeResult | "busy">
  count: (delta: Record<string, number>) => void
  setWakeup: (at: number) => Promise<void>
  clearWakeup: () => Promise<void>
}

type PassReport = { at: number; expired: number; woke: { id: string; room: string; to: string; result: WakeResult | "busy" }[]; retryAt: number | null }

export class InitiativeEngine {
  constructor(private readonly d: EngineDeps) {}

  link(reminderId: string, loopId: number): void {
    this.d.sql.exec("INSERT OR REPLACE INTO loop_reminders (reminder_id, loop_id) VALUES (?, ?)", reminderId, loopId)
  }

  /** What the agent runs this engine started, and the reminders of agent promises, report back. */
  results(batch: SignalBatch): void {
    for (const s of batch.signals) {
      if (s.kind !== "routine_result") continue
      if (s.routineId === INITIATIVE_RUN) this.ran(s.occurrence, s.outcome === "ok")
      else if (s.routineId === REMINDER_RUN) this.kept(s.occurrence, s.outcome === "ok", Date.now())
    }
  }

  /** An agent that spoke on its own promise kept it. */
  private ran(wakeId: string, spoke: boolean): void {
    if (!spoke) return
    const row = this.d.sql.exec<{ slug: string; ids: string }>("SELECT slug, ids FROM initiative_wakes WHERE id = ?", wakeId).toArray()[0]
    const id = row?.ids.startsWith("loop:") ? Number(row.ids.slice(5)) : null
    if (id !== null && this.d.loops.get(id)?.owner === row?.slug && this.d.loops.close(id, "done")) this.d.count({ loops_closed: 1 })
  }

  private kept(reminderId: string, posted: boolean, now: number): void {
    if (posted) {
      for (const r of this.d.sql.exec<{ loop_id: number }>("SELECT loop_id FROM loop_reminders WHERE reminder_id = ?", reminderId).toArray()) {
        if (this.d.loops.close(r.loop_id, "done", now)) this.d.count({ loops_closed: 1 })
      }
    }
    this.d.sql.exec("DELETE FROM loop_reminders WHERE reminder_id = ?", reminderId)
  }

  /** The loops due or overdue, oldest due first, that no reminder is about to keep and that were not nudged lately. */
  private due(now: number): Loop[] {
    const ids = this.d.sql
      .exec<{ id: number }>(
        `SELECT l.id FROM loops l
         WHERE (l.status = 'open' OR (l.status = 'snoozed' AND l.snoozed_until <= ?)) AND l.due IS NOT NULL AND l.due <= ?
           AND NOT EXISTS (SELECT 1 FROM initiative_wakes w WHERE w.ids = 'loop:' || l.id AND w.at > ?)
           AND NOT EXISTS (SELECT 1 FROM loop_reminders k JOIN reminders r ON r.id = k.reminder_id WHERE k.loop_id = l.id AND (r.status = 'active' OR (r.status = 'done' AND r.last_fired > ?)))
         ORDER BY l.due, l.id LIMIT ?`,
        now,
        new Date(now).toISOString(),
        now - RENUDGE_MS,
        now - REMINDER_RUN_WINDOW,
        TRIES * 4,
      )
      .toArray()
      .map((r) => r.id)
    return ids.flatMap((id) => this.d.loops.get(id) ?? [])
  }

  /** Where a loop is raised: its own chat if the human may still be read there, the Kiko chat if it has none. */
  private roomOf(l: Loop): string | null {
    if (!l.room) return this.d.home()
    return this.d.title(l.room) === null ? null : l.room
  }

  async arm(now = Date.now()): Promise<number | null> {
    const level = this.d.level()
    if (level === "off" || level === "chat") {
      await this.d.clearWakeup()
      return null
    }
    const retry = Number(getSetting(this.d.sql, RETRY_AT) ?? 0)
    const tz = this.d.tz()
    const at = retry > now ? retry : (nextOccurrence(DAILY_AT_NINE, validZone(tz) ? tz : "UTC", now)?.getTime() ?? now + DAY)
    await this.d.setWakeup(at)
    return at
  }

  /** The daily pass: stale plans close, then the oldest loop that is due wakes its chat's lead once. A wake that did not land retries in an hour. */
  async pass(now = Date.now()): Promise<PassReport> {
    setSetting(this.d.sql, RETRY_AT, "0")
    this.prune(now)
    const expired = this.d.loops.expire(now - STALE_MS, now)
    if (expired) this.d.count({ loops_closed: expired })
    const report: PassReport = { at: now, expired, woke: [], retryAt: null }
    const level = this.d.level()
    let tried = 0
    let landed = 0
    if (level === "digest" || level === "active") {
      const raised = new Set<string>()
      for (const loop of this.due(now)) {
        const room = this.roomOf(loop)
        if (!room || raised.has(room)) continue
        if (++tried > TRIES) break
        const own = loop.owner !== "human"
        const id = `loop:${loop.id}#${Math.floor(now / DAY)}`
        const result = await this.d.wake(room, { id, to: own ? (loop.owner as AgentSlug) : null, body: wakeBody(loop, own, now), reason: own ? `Promised ${day(loop.openedAt, this.d.tz())}` : `You mentioned this ${day(loop.openedAt, this.d.tz())}` })
        report.woke.push({ id, room, to: own ? loop.owner : "lead", result })
        if (result === "delivered" || result === "duplicate") {
          this.d.sql.exec("INSERT OR IGNORE INTO initiative_wakes (id, room, slug, kind, ids, at, status) VALUES (?, ?, ?, ?, ?, ?, 'sent')", id, room, own ? loop.owner : "lead", loop.kind, `loop:${loop.id}`, now)
          this.d.count({ initiative_woke: 1 })
          raised.add(room)
          if (++landed >= PER_PASS[level]) break
        }
      }
      if (tried && !landed) {
        report.retryAt = now + HOUR
        setSetting(this.d.sql, RETRY_AT, String(report.retryAt))
      }
    }
    await this.arm(now)
    return report
  }

  /** The human's own plans in this chat to mention on a run, not yet shown in the last day. The caller says which were shown with `briefed`. */
  noticed(roomId: string, skip: ReadonlySet<number>, now = Date.now()): { id: number; line: string }[] {
    if (this.d.level() === "off") return []
    const shown = new Map(this.d.sql.exec<{ loop_id: number; at: number }>("SELECT loop_id, at FROM initiative_briefed").toArray().map((r) => [r.loop_id, r.at]))
    const tz = this.d.tz()
    return this.d.loops
      .list({ owner: "human", room: roomId, status: ["open"], limit: 50 })
      .filter((l) => !skip.has(l.id) && now >= (shown.get(l.id) ?? -Infinity) + DAY)
      .sort((a, b) => Number(a.due === null) - Number(b.due === null) || (a.due ?? "").localeCompare(b.due ?? ""))
      .slice(0, NOTICED_MAX)
      .map((l) => ({ id: l.id, line: `${loopLine(l)} (said ${day(l.openedAt, tz)}, last mentioned ${ago(l.lastSeen, now)})` }))
  }

  briefed(loopIds: readonly number[], now = Date.now()): void {
    this.d.sql.exec("INSERT INTO initiative_briefed (loop_id, at) SELECT value, ? FROM json_each(?) WHERE true ON CONFLICT(loop_id) DO UPDATE SET at = excluded.at", now, JSON.stringify(loopIds))
  }

  private prune(now: number): void {
    const cutoff = now - KEEP_MS
    this.d.sql.exec("DELETE FROM initiative_briefed WHERE at < ?", cutoff)
    this.d.sql.exec("DELETE FROM initiative_wakes WHERE at < ?", cutoff)
  }
}

const NUDGE_RULE = "one short message in your own words, at most two sentences. no text around tool calls. reply only [skip] when this chat shows it is already handled."

function wakeBody(l: Loop, own: boolean, now: number): string {
  const line = `${loopLine(l)} (last mentioned ${ago(l.lastSeen, now)})`
  if (own) {
    return [
      `initiative: you promised this and it is still open: ${line}.`,
      "keep it now in one short message: the result, or one line on why you cannot. no text around tool calls.",
      `then close L${l.id} done with the loop tool. if this chat shows it was already kept, close it and reply only [skip].`,
    ].join("\n")
  }
  return [
    `initiative: this is due and still open:\n- ${line}`,
    `raise it now: ${NUDGE_RULE} if it is a teammate's work, ask that teammate with send_message instead.`,
    `if the human says they no longer want it, close L${l.id} as dropped with the loop tool.`,
  ].join("\n")
}

export const day = (at: number, tz: string) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: validZone(tz) ? tz : "UTC" })

function span(ms: number): string {
  const h = Math.round(ms / HOUR)
  return h < 36 ? `${Math.max(1, h)} hours` : `${Math.round(h / 24)} days`
}

const ago = (at: number, now: number) => (now - at < HOUR ? "just now" : `${span(now - at)} ago`)
