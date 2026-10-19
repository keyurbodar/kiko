import type { RoomId, RoutineRunStatus, Trigger } from "@kiko/protocol"
import type { Alarms } from "@kiko/durable/alarm"
import { RRule } from "rrule"
import { sha256Hex, toHex } from "@kiko/durable/hash"
import { getSetting, setSetting } from "../lib/settings"
import { nextOccurrence, repeatProblem, validZone } from "@kiko/sandbox/recurrence"
import { MIN_REPEAT_MS, ruleProblem } from "@kiko/sandbox/rule"

export const REMINDERS_WAKEUP = "reminders"
export const MAX_ROUTINES = 50
const YEAR_MS = 365 * 86_400_000
export const RUNS_KEPT = 20
const LATE_MS = 60 * 60_000
export const MAX_FAILS = 3
const RUNS_PER_PASS = 10
const LOST_RUN_MS = 2 * 60 * 60_000
const RETRY_MS = 30_000
const MAX_SKIPS = 10_000
const MAX_TEXT = 2000

// failed is only on rows stored before reminders became routines.
export type ReminderStatus = "active" | "paused" | "done" | "cancelled" | "failed"

export type Reminder = {
  id: string
  text: string
  dueUtc: number
  tz: string
  rrule: string | null
  roomId: RoomId
  target: string
  createdBy: string
  status: ReminderStatus
  lastFired: number | null
  name: string | null
  trigger: Trigger | null
  fails: number
}

export type RoutineRun = { routineId: string; occurrence: string; startedAt: number; endedAt: number | null; status: RoutineRunStatus; seq: number | null }

export type NewRoutine = {
  name: string
  instructions: string
  trigger: Trigger
  tz: string
  roomId: RoomId
  target: string
  createdBy: string
}

export type RunDelivery = "delivered" | "held" | "refused" | "gone" | "duplicate" | "skipped"

export type DeliverRun = (input: { deliveryId: string; routine: Reminder; body: string }) => Promise<RunDelivery>

export type Notice = (roomId: RoomId, id: string, text: string) => Promise<void>

export type RunGate = { away(): boolean }

export class ReminderError extends Error {}

type Row = {
  id: string
  text: string
  due_utc: number
  tz: string
  rrule: string | null
  room_id: string
  target: string
  created_by: string
  status: string
  last_fired: number | null
  name: string | null
  trigger: string | null
  fails: number
}

const toReminder = (r: Row): Reminder => ({
  name: r.name,
  trigger: r.trigger ? (JSON.parse(r.trigger) as Trigger) : null,
  fails: r.fails ?? 0,
  id: r.id,
  text: r.text,
  dueUtc: r.due_utc,
  tz: r.tz,
  rrule: r.rrule,
  roomId: r.room_id as RoomId,
  target: r.target,
  createdBy: r.created_by,
  status: r.status as ReminderStatus,
  lastFired: r.last_fired,
})

// The one place a time is parsed, so every routine obeys the same horizon.
function parseTime(time: string, now: number): number {
  if (!/(z|[+-]\d{2}:?\d{2})$/i.test(time.trim())) throw new ReminderError("time must include an offset or z")
  const at = Date.parse(time)
  if (Number.isNaN(at)) throw new ReminderError("time is not an iso date")
  const due = Math.ceil(at / 1000) * 1000
  if (due > now + YEAR_MS) throw new ReminderError("time is more than a year away")
  return due
}

export function nextAfter(rrule: string, tz: string, due: number, now: number): number | null {
  if (ruleProblem(rrule)) return null
  let at = due
  for (let i = 0; i < MAX_SKIPS; i++) {
    const next = nextOccurrence(rrule, tz, at)
    if (!next) return null
    if (next.getTime() > now) return next.getTime()
    at = next.getTime()
  }
  return null
}

export type RoutinePorts = { deliverRun: DeliverRun; notice: Notice; gate: RunGate }

export class Reminders {
  constructor(
    private readonly sql: SqlStorage,
    private readonly alarms: Alarms,
    private readonly now: () => number = Date.now,
    private readonly ports?: RoutinePorts,
    private readonly changed: () => void = () => {},
  ) {
  }

  get(id: string): Reminder | null {
    const row = this.sql.exec<Row>("SELECT * FROM reminders WHERE id = ?", id).toArray()[0]
    return row ? toReminder(row) : null
  }

  private required(id: string): Reminder {
    const reminder = this.get(id)
    if (!reminder) throw new ReminderError(`no reminder ${id}`)
    return reminder
  }

  list(): Reminder[] {
    return this.sql
      .exec<Row>(
        "SELECT * FROM reminders WHERE trigger IS NOT NULL ORDER BY status = 'active' DESC, CASE WHEN status = 'active' THEN due_utc ELSE -due_utc END",
      )
      .toArray()
      .map(toReminder)
  }

  /** The routines that can still run or be reported on. Done and cancelled rows only grow the table. */
  triggered(): Reminder[] {
    return this.sql.exec<Row>("SELECT * FROM reminders WHERE trigger IS NOT NULL AND status IN ('active', 'paused')").toArray().map(toReminder)
  }

  owner(): string | null {
    const value = getSetting(this.sql, "owner")
    return value ? (JSON.parse(value) as string) : null
  }

  private claim(owner: string, roomId: string): void {
    if (this.owner() === null) {
      setSetting(this.sql, "owner", JSON.stringify(owner))
    } else if (this.owner() !== owner) {
      throw new ReminderError("wrong owner")
    }
    if (!this.sql.exec("SELECT 1 FROM chats WHERE room_id = ?", roomId).toArray().length) {
      throw new ReminderError("unknown chat")
    }
  }

  async createRoutine(owner: string, input: NewRoutine): Promise<{ routine: Reminder; token?: string }> {
    this.claim(owner, input.roomId)
    const fields = this.routineFields(input)
    const token = input.trigger.on === "webhook" ? toHex(crypto.getRandomValues(new Uint8Array(24))) : undefined
    const tokenHash = token ? await sha256Hex(token) : null
    const open = this.sql
      .exec<{ n: number }>("SELECT count(*) AS n FROM reminders WHERE room_id = ? AND target = ? AND trigger IS NOT NULL AND status IN ('active', 'paused')", input.roomId, input.target)
      .one().n
    if (open >= MAX_ROUTINES) throw new ReminderError(`@${input.target} already has ${MAX_ROUTINES} routines in this chat. cancel one first.`)
    const id = crypto.randomUUID()
    this.sql.exec(
      `INSERT INTO reminders (id, text, due_utc, tz, rrule, room_id, target, created_by, status, last_fired, created_at, name, trigger, fails, hook_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?, 0, ?)`,
      id,
      fields.text,
      fields.due,
      input.tz,
      fields.rrule,
      input.roomId,
      input.target,
      input.createdBy,
      this.now(),
      fields.name,
      JSON.stringify(input.trigger),
      tokenHash,
    )
    await this.rearm()
    return { routine: this.required(id), ...(token ? { token } : {}) }
  }

  private routineFields(input: Pick<NewRoutine, "name" | "instructions" | "trigger" | "tz" | "target">, validateFreshness = true): { name: string; text: string; due: number; rrule: string | null } {
    const name = input.name.trim().toLowerCase().replace(/\s+/g, " ")
    if (!name || name.length > 60) throw new ReminderError("name must be 1 to 60 characters")
    const text = input.instructions.trim()
    if (!text) throw new ReminderError("instructions are empty")
    if (text.length > MAX_TEXT) throw new ReminderError(`instructions are longer than ${MAX_TEXT} characters`)
    if (!/^[a-z0-9-]{1,32}$/.test(input.target)) throw new ReminderError("a routine runs as an agent in this chat")
    if (!validZone(input.tz)) throw new ReminderError("unknown time zone")
    const t = input.trigger
    const now = this.now()
    switch (t.on) {
      case "time": {
        let due = parseTime(t.at, now)
        const rrule = t.rrule?.trim().replace(/^RRULE:/i, "") || null
        if (rrule) {
          checkRepeat(rrule, input.tz, due)
          if (validateFreshness && due <= now) due = nextAfter(rrule, input.tz, due, now) ?? fail("the rule has no time after now")
        } else if (validateFreshness && due < now - 1000) throw new ReminderError("that time is in the past. pick a future time.")
        return { name, text, due, rrule }
      }
      case "message":
      case "webhook":
        return { name, text, due: 0, rrule: null }
      default:
        throw new ReminderError(`its ${(t as { on: string }).on} trigger is no longer supported. give it a time, message, or webhook trigger.`)
    }
  }

  async updateRoutine(id: string, patch: { name?: string; instructions?: string; trigger?: Trigger; status?: "active" | "paused" }): Promise<{ routine: Reminder; token?: string } | null> {
    const current = this.get(id)
    if (!current?.trigger || current.status === "cancelled" || (current.status === "done" && patch.trigger === undefined)) return null
    // Only a routine that becomes a webhook gets a token; an existing webhook keeps the one it has.
    const fresh = patch.trigger?.on === "webhook" && current.trigger.on !== "webhook" ? toHex(crypto.getRandomValues(new Uint8Array(24))) : undefined
    const freshHash = fresh ? await sha256Hex(fresh) : null
    const trigger = patch.trigger ?? current.trigger
    const retimed = patch.trigger !== undefined || (patch.status === "active" && current.status !== "active")
    const fields = this.routineFields({ name: patch.name ?? current.name ?? "", instructions: patch.instructions ?? current.text, trigger, tz: current.tz, target: current.target }, retimed)
    const due = retimed ? fields.due : current.dueUtc
    const status = patch.status ?? (current.status === "done" ? "active" : current.status)
    this.sql.exec(
      `UPDATE reminders SET name = ?, text = ?, trigger = ?, rrule = ?, due_utc = ?, status = ?, fails = CASE WHEN ? = 'active' THEN 0 ELSE fails END,
       hook_hash = coalesce(?, hook_hash) WHERE id = ?`,
      fields.name,
      fields.text,
      JSON.stringify(trigger),
      fields.rrule,
      due,
      status,
      patch.status ?? (current.status === "done" ? "active" : ""),
      freshHash,
      id,
    )
    await this.rearm()
    return { routine: this.required(id), ...(fresh ? { token: fresh } : {}) }
  }

  /** The active routine whose webhook token hashes to `hash`. The token is the credential, so no id comes with it. */
  byHook(hash: string): Reminder | null {
    const row = this.sql.exec<Row>("SELECT * FROM reminders WHERE hook_hash = ? AND status = 'active'", hash).toArray()[0]
    return row ? toReminder(row) : null
  }

  runs(routineId?: string): RoutineRun[] {
    this.expireLostRuns()
    const rows = routineId
      ? this.sql.exec<RunRow>("SELECT * FROM routine_runs WHERE routine_id = ? ORDER BY started_at DESC", routineId).toArray()
      : this.sql.exec<RunRow>("SELECT * FROM routine_runs ORDER BY started_at DESC LIMIT 200").toArray()
    return rows.map(toRun)
  }

  private expireLostRuns(): void {
    const now = this.now()
    this.sql.exec("UPDATE routine_runs SET status = 'failed', ended_at = ? WHERE status = 'running' AND started_at < ?", now, now - LOST_RUN_MS)
  }

  private beginRun(routineId: string, occurrence: string): boolean {
    const added = this.sql.exec(
      "INSERT INTO routine_runs (routine_id, occurrence, started_at, ended_at, status, seq) VALUES (?, ?, ?, NULL, 'running', NULL) ON CONFLICT DO NOTHING",
      routineId,
      occurrence,
      this.now(),
    )
    if (added.rowsWritten > 0) this.changed()
    return added.rowsWritten > 0
  }

  private settleRun(routineId: string, occurrence: string, delivery: RunDelivery, fresh: boolean): void {
    if (fresh && delivery !== "delivered" && delivery !== "duplicate") {
      const status: RoutineRunStatus = delivery === "held" ? "held" : delivery === "skipped" ? "quiet" : "failed"
      this.sql.exec("UPDATE routine_runs SET status = ?, ended_at = ? WHERE routine_id = ? AND occurrence = ? AND status = 'running'", status, this.now(), routineId, occurrence)
    }
    this.sql.exec(
      "DELETE FROM routine_runs WHERE routine_id = ? AND occurrence NOT IN (SELECT occurrence FROM routine_runs WHERE routine_id = ? ORDER BY started_at DESC LIMIT ?)",
      routineId,
      routineId,
      RUNS_KEPT,
    )
  }

  async finishRun(routineId: string, occurrence: string, status: Exclude<RoutineRunStatus, "running" | "held">, seq: number | null): Promise<void> {
    const changed = this.sql.exec(
      "UPDATE routine_runs SET status = ?, ended_at = ?, seq = ? WHERE routine_id = ? AND occurrence = ? AND status = 'running'",
      status,
      this.now(),
      seq,
      routineId,
      occurrence,
    )
    if (!changed.rowsWritten) return
    this.changed()
    if (status === "failed" || status === "timeout") await this.countFailure(routineId, occurrence)
    else this.sql.exec("UPDATE reminders SET fails = 0 WHERE id = ?", routineId)
  }

  // One failed run. At MAX_FAILS a routine pauses. The human hears once per occurrence.
  private async countFailure(id: string, occurrence: string): Promise<void> {
    this.sql.exec("UPDATE reminders SET fails = fails + 1 WHERE id = ?", id)
    const routine = this.get(id)
    if (!routine || routine.fails < MAX_FAILS) return
    if (!this.sql.exec("UPDATE reminders SET status = 'paused' WHERE id = ? AND status = 'active'", id).rowsWritten) return
    await this.rearm()
    const text = `routine "${routine.name}" paused itself: its last ${MAX_FAILS} runs failed. ask @${routine.target} to look at it, or resume it.`
    await this.ports?.notice(routine.roomId, `paused:${id}:${occurrence}`, text).catch((e: unknown) => console.error(`paused notice not sent: ${e instanceof Error ? e.message : String(e)}`))
  }

  async runNow(id: string): Promise<RunDelivery | null> {
    const routine = this.get(id)
    if (!routine?.trigger || routine.status !== "active" || !this.ports) return null
    const n = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM routine_runs WHERE routine_id = ? AND occurrence LIKE 'test:%'", id).one().n + 1
    const occurrence = `test:${this.now()}:${n}`
    return this.run(routine, occurrence, "a test run the human or an agent asked for", "")
  }

  async fireEvent(id: string, occurrence: string, what: string, extra: string): Promise<RunDelivery | null> {
    const routine = this.get(id)
    if (!routine?.trigger || routine.status !== "active" || !this.ports) return null
    if (routine.trigger.on !== "message" && routine.trigger.on !== "webhook") return null
    return this.run(routine, occurrence, what, extra)
  }

  private async run(routine: Reminder, occurrence: string, why: string, extra: string): Promise<RunDelivery> {
    if (!this.ports) return "refused"
    const body = routineBody(routine, why, this.lastRun(routine.id), extra)
    const fresh = this.beginRun(routine.id, occurrence)
    const delivery = this.ports.gate.away() ? "held" : await this.ports.deliverRun({ deliveryId: `${routine.id}:${occurrence}`, routine, body }).catch(thrownAsRefused)
    if (delivery === "gone") {
      this.sql.exec("UPDATE reminders SET status = 'cancelled' WHERE id = ?", routine.id)
      await this.rearm()
    }
    if (fresh && delivery === "refused") await this.countFailure(routine.id, occurrence)
    this.settleRun(routine.id, occurrence, delivery, fresh)
    return delivery
  }

  private lastRun(routineId: string): RoutineRun | null {
    const row = this.sql.exec<RunRow>("SELECT * FROM routine_runs WHERE routine_id = ? AND status != 'running' ORDER BY started_at DESC LIMIT 1", routineId).toArray()[0]
    return row ? toRun(row) : null
  }

  roomRoutines(roomId: string): Reminder[] {
    return this.sql
      .exec<Row>("SELECT * FROM reminders WHERE room_id = ? AND status = 'active' AND json_extract(trigger, '$.on') = 'message'", roomId)
      .toArray()
      .map(toReminder)
  }

  async makeDue(id: string): Promise<void> {
    this.sql.exec("UPDATE reminders SET due_utc = ? WHERE id = ? AND status = 'active' AND due_utc > 0", this.now(), id)
    await this.rearm()
  }

  async cancel(id: string): Promise<Reminder | null> {
    const current = this.get(id)
    if (!current || current.status === "cancelled") return current
    this.sql.exec("UPDATE reminders SET status = 'cancelled', hook_hash = NULL WHERE id = ?", id)
    await this.rearm()
    return this.get(id)
  }

  /** A deleted chat takes its reminders and routines with it. */
  async cancelRoom(roomId: string): Promise<void> {
    this.purge(this.sql.exec<{ id: string }>("SELECT id FROM reminders WHERE room_id = ?", roomId).toArray().map((row) => row.id))
    await this.rearm()
  }

  async cancelAgent(slug: string): Promise<void> {
    this.purge(this.sql.exec<{ id: string }>("SELECT id FROM reminders WHERE target = ? OR created_by = ?", slug, slug).toArray().map((row) => row.id))
    await this.rearm()
  }

  private purge(ids: string[]): void {
    if (!ids.length) return
    const list = JSON.stringify(ids)
    this.sql.exec("DELETE FROM routine_runs WHERE routine_id IN (SELECT value FROM json_each(?))", list)
    this.sql.exec("DELETE FROM recipe_links WHERE routine_id IN (SELECT value FROM json_each(?))", list)
    this.sql.exec("DELETE FROM loop_reminders WHERE reminder_id IN (SELECT value FROM json_each(?))", list)
    this.sql.exec("DELETE FROM reminders WHERE id IN (SELECT value FROM json_each(?))", list)
  }

  /** Drops a routine that was just created, when the wiring around it failed. */
  remove(id: string): void {
    this.sql.exec("DELETE FROM reminders WHERE id = ?", id)
  }

  async cancelCreatedBy(createdBy: string): Promise<number> {
    const changed = this.sql.exec("UPDATE reminders SET status = 'cancelled', hook_hash = NULL WHERE created_by = ? AND status = 'active'", createdBy)
    if (changed.rowsWritten) await this.rearm()
    return changed.rowsWritten
  }

  async fire(): Promise<void> {
    const now = this.now()
    await this.alarms.setWakeup(REMINDERS_WAKEUP, now + RETRY_MS)
    const due = this.sql
      .exec<Row>("SELECT * FROM reminders WHERE status = 'active' AND trigger IS NOT NULL AND due_utc > 0 AND due_utc <= ? ORDER BY due_utc, id", now)
      .toArray()
      .map(toReminder)
    let failed = false
    let delivered = 0
    this.expireLostRuns()
    for (const reminder of due) {
      if (++delivered > RUNS_PER_PASS) {
        failed = true
        continue
      }
      try {
        if (reminder.rrule === null || this.now() - reminder.dueUtc <= LATE_MS) await this.run(reminder, String(reminder.dueUtc), "its scheduled time", "")
      } catch {
        failed = true
        continue
      }
      const next = nextTime(reminder, this.now())
      this.sql.exec(
        `UPDATE reminders SET last_fired = due_utc, due_utc = ?, status = ?
         WHERE id = ? AND due_utc = ? AND status = 'active'`,
        next ?? reminder.dueUtc,
        next === null ? "done" : "active",
        reminder.id,
        reminder.dueUtc,
      )
    }
    await this.rearm(failed ? this.now() + (delivered > RUNS_PER_PASS ? 1_000 : RETRY_MS) : 0)
  }

  private async rearm(notBefore = 0): Promise<void> {
    this.changed()
    const { at } = this.sql
      .exec<{ at: number | null }>("SELECT min(due_utc) AS at FROM reminders WHERE status = 'active' AND due_utc > 0")
      .one()
    if (at === null) await this.alarms.clearWakeup(REMINDERS_WAKEUP)
    else await this.alarms.setWakeup(REMINDERS_WAKEUP, Math.max(at, notBefore))
  }
}

type RunRow = { routine_id: string; occurrence: string; started_at: number; ended_at: number | null; status: string; seq: number | null }

const toRun = (r: RunRow): RoutineRun => ({ routineId: r.routine_id, occurrence: r.occurrence, startedAt: r.started_at, endedAt: r.ended_at, status: r.status as RoutineRunStatus, seq: r.seq })

const fail = (message: string): never => {
  throw new ReminderError(message)
}

// A throw from the room is a refusal, so the failure counts the same way a refused run does.
const thrownAsRefused = (e: unknown): "refused" => {
  console.error(`delivery refused: ${e instanceof Error ? e.message : String(e)}`)
  return "refused"
}


function checkRepeat(rrule: string, tz: string, from: number): void {
  const problem = repeatProblem(rrule, tz, from)
  if (problem) throw new ReminderError(problem)
}

export function nextTime(r: Pick<Reminder, "rrule" | "tz" | "dueUtc">, now: number): number | null {
  return r.rrule ? nextAfter(r.rrule, r.tz, r.dueUtc, Math.max(now, r.dueUtc + MIN_REPEAT_MS - 1)) : null
}

// Built from parts so the text does not depend on the host ICU version, which joins date and time differently.
export function localTime(at: number, tz: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(at))
      .map((x) => [x.type, x.value]),
  )
  return `${p.weekday}, ${p.month} ${p.day} at ${p.hour}:${p.minute}`.toLowerCase()
}

function ruleText(rrule: string): string {
  try {
    return RRule.fromString(rrule.replace(/^RRULE:/i, "")).toText().toLowerCase()
  } catch {
    return rrule.toLowerCase()
  }
}

export function describeTrigger(trigger: Trigger, tz: string, due: number): string {
  switch (trigger.on) {
    case "time":
      return trigger.rrule ? `${ruleText(trigger.rrule)}, next ${localTime(due, tz)} (${tz})` : `once, ${localTime(due, tz)} (${tz})`
    case "message":
      return `when the human posts here${trigger.contains ? ` a message containing "${trigger.contains}"` : ""}`
    case "webhook":
      return `when its webhook gets a post${trigger.match?.length ? " that matches" : ""}`
    default:
      return "a trigger kiko no longer supports. it is paused"
  }
}

export function routineBody(routine: Reminder, why: string, last: RoutineRun | null, extra: string): string {
  const trigger = routine.trigger
  if (!trigger) throw new ReminderError("routine has no trigger")
  const lines = [
    `routine "${routine.name}" (id ${routine.id}), run because of ${why}.`,
    `it runs ${describeTrigger(trigger, routine.tz, routine.dueUtc)}.`,
    last ? `last run: ${last.status}, ${localTime(last.startedAt, routine.tz)}.` : "this is its first run.",
    "instructions:",
    routine.text,
    "",
    "if the instructions ask you to send or report something, send it now, even when it is the same as last time. answer [skip] only when they say to stay quiet when nothing is new, or ask for nothing.",
  ]
  if (extra) lines.push("", extra)
  return lines.join("\n")
}
