import type { RoomId, RoutineRunStatus, Trigger } from "@yuki/protocol"
import type { Env } from "../index"
import type { Alarms } from "@yuki/durable/alarm"
import { roomStub } from "../lib/names"
import type { Chain } from "../room/mail"
import { RRule } from "rrule"
import { sha256Hex, toHex } from "@yuki/durable/hash"
import { getSetting, setSetting } from "../lib/settings"
import { nextOccurrence, repeatProblem, validZone } from "@yuki/sandbox/recurrence"
import { MIN_REPEAT_MS, ruleProblem } from "@yuki/sandbox/rule"

export const REMINDERS_WAKEUP = "reminders"
export const MAX_ROUTINES = 50
const MAX_REMINDERS = 100
const YEAR_MS = 365 * 86_400_000
export const RUNS_KEPT = 20
const LATE_MS = 60 * 60_000
export const MAX_FAILS = 3
const WATCHES_PER_PASS = 10
const RUNS_PER_PASS = 10
export const MAX_WATCHES = 10
const MAX_WATCH_ERRORS = 10
const LOST_RUN_MS = 2 * 60 * 60_000
const WATCH_EXCERPT = 3_000
const RETRY_MS = 30_000
const MAX_SKIPS = 10_000
const MAX_TEXT = 2000

// failed: a one-off reminder that could not post after MAX_FAILS tries. snooze it to try again.
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
  chain: Chain | null
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

export type WatchFetch = (trigger: Extract<Trigger, { on: "watch" }>) => Promise<{ ok: true; text: string } | { ok: false; error: string }>

export type Notice = (roomId: RoomId, id: string, text: string) => Promise<void>

export type RunGate = { away(): boolean }

export type NewReminder = {
  text: string
  time: string
  tz: string
  rrule?: string
  roomId: RoomId
  target?: string
  createdBy?: string
  chain?: Chain
}

export type Deliver = (deliveryId: string, reminder: Reminder) => Promise<unknown>

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
  chain: string | null
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
  chain: r.chain ? (JSON.parse(r.chain) as Chain) : null,
})

export const deliveryId = (r: Pick<Reminder, "id" | "dueUtc">) => `${r.id}:${r.dueUtc}`
// The one place a time is parsed, so every reminder, routine, and snooze obeys the same horizon.
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

export type ReminderResult = { ok: true; reminder: Reminder } | { ok: false; error: string }

export async function asResult(run: () => Promise<Reminder | null>): Promise<ReminderResult> {
  try {
    const reminder = await run()
    return reminder ? { ok: true, reminder } : { ok: false, error: "no such reminder" }
  } catch (e) {
    if (e instanceof ReminderError) return { ok: false, error: e.message }
    throw e
  }
}

export function roomDelivery(env: Env, owner: () => string | null): Deliver {
  return async (id, reminder) => {
    const userId = owner()
    if (!userId) throw new ReminderError("no owner")
    return roomStub(env.ROOM, userId, reminder.roomId).deliverReminder(id, { text: reminder.text, target: reminder.target, createdBy: reminder.createdBy, chain: reminder.chain, recurring: reminder.rrule !== null })
  }
}

export type RoutinePorts = { deliverRun: DeliverRun; watch: WatchFetch; notice: Notice; gate: RunGate }

export class Reminders {
  constructor(
    private readonly sql: SqlStorage,
    private readonly alarms: Alarms,
    private readonly deliver: Deliver,
    private readonly now: () => number = Date.now,
    private readonly ports?: RoutinePorts,
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
        "SELECT * FROM reminders ORDER BY status = 'active' DESC, CASE WHEN status = 'active' THEN due_utc ELSE -due_utc END",
      )
      .toArray()
      .map(toReminder)
  }

  owner(): string | null {
    const value = getSetting(this.sql, "owner")
    return value ? (JSON.parse(value) as string) : null
  }

  async create(owner: string, input: NewReminder): Promise<Reminder> {
    this.claim(owner, input.roomId)
    const text = input.text.trim()
    if (!text) throw new ReminderError("text is empty")
    if (text.length > MAX_TEXT) throw new ReminderError("text is too long")
    if (!validZone(input.tz)) throw new ReminderError("unknown time zone")
    const due = parseTime(input.time, this.now())
    const rrule = input.rrule?.trim() || null
    if (rrule) {
      const problem = ruleProblem(rrule)
      if (problem) throw new ReminderError(problem)
      try {
        nextOccurrence(rrule, input.tz, due)
      } catch {
        throw new ReminderError("rrule does not parse")
      }
    }
    const target = input.target?.trim() || "human"
    if (target !== "human" && !/^[a-z0-9-]{1,32}$/.test(target)) throw new ReminderError("bad target")
    if (rrule) checkRepeat(rrule, input.tz, due)
    const open = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM reminders WHERE room_id = ? AND trigger IS NULL AND status = 'active'", input.roomId).one().n
    if (open >= MAX_REMINDERS) throw new ReminderError(`this chat already has ${MAX_REMINDERS} reminders. cancel one first.`)
    const id = crypto.randomUUID()
    const chain = input.chain
    this.sql.exec(
      `INSERT INTO reminders (id, text, due_utc, tz, rrule, room_id, target, created_by, status, last_fired, created_at, chain)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?)`,
      id,
      text,
      due,
      input.tz,
      rrule,
      input.roomId,
      target,
      input.createdBy ?? "human",
      this.now(),
      chain ? JSON.stringify(chain) : null,
    )
    await this.rearm()
    return this.required(id)
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
    if (input.trigger.on === "watch" && this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM reminders WHERE status IN ('active', 'paused') AND json_extract(trigger, '$.on') = 'watch'").one().n >= MAX_WATCHES) {
      throw new ReminderError(`there are already ${MAX_WATCHES} watches. cancel one first.`)
    }
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

  private routineFields(input: Pick<NewRoutine, "name" | "instructions" | "trigger" | "tz" | "target">): { name: string; text: string; due: number; rrule: string | null } {
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
          if (due <= now) due = nextAfter(rrule, input.tz, due, now) ?? fail("the rule has no time after now")
        } else if (due < now - 1000) throw new ReminderError("that time is in the past. pick a future time.")
        return { name, text, due, rrule }
      }
      case "watch": {
        let url: URL
        try {
          url = new URL(t.url)
        } catch {
          throw new ReminderError("watch url is not a url")
        }
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new ReminderError("a watch reaches http and https urls only")
        if (t.extension && url.protocol !== "https:") throw new ReminderError("a watch through an extension reaches https urls only")
        if (t.headers && !t.extension) throw new ReminderError("headers need an extension, whose secrets they may use")
        return { name, text, due: now + 1000, rrule: null }
      }
      default:
        return { name, text, due: 0, rrule: null }
    }
  }

  async updateRoutine(id: string, patch: { name?: string; instructions?: string; trigger?: Trigger; status?: "active" | "paused" }): Promise<{ routine: Reminder; token?: string } | null> {
    const current = this.get(id)
    if (!current?.trigger || current.status === "cancelled" || current.status === "done") return null
    // Only a routine that becomes a webhook gets a token; an existing webhook keeps the one it has.
    const fresh = patch.trigger?.on === "webhook" && current.trigger.on !== "webhook" ? toHex(crypto.getRandomValues(new Uint8Array(24))) : undefined
    const freshHash = fresh ? await sha256Hex(fresh) : null
    const trigger = patch.trigger ?? current.trigger
    const fields = this.routineFields({ name: patch.name ?? current.name ?? "", instructions: patch.instructions ?? current.text, trigger, tz: current.tz, target: current.target })
    const retimed = patch.trigger !== undefined || (patch.status === "active" && current.status === "paused")
    const due = retimed ? fields.due : current.dueUtc
    this.sql.exec(
      `UPDATE reminders SET name = ?, text = ?, trigger = ?, rrule = ?, due_utc = ?, status = ?, fails = CASE WHEN ? = 'active' THEN 0 ELSE fails END,
       watch_state = CASE WHEN ? THEN NULL ELSE watch_state END, hook_hash = coalesce(?, hook_hash) WHERE id = ?`,
      fields.name,
      fields.text,
      JSON.stringify(trigger),
      fields.rrule,
      due,
      patch.status ?? current.status,
      patch.status ?? "",
      patch.trigger !== undefined ? 1 : 0,
      freshHash,
      id,
    )
    await this.rearm()
    return { routine: this.required(id), ...(fresh ? { token: fresh } : {}) }
  }

  async byHook(id: string, token: string): Promise<Reminder | null> {
    const row = this.sql.exec<Row & { hook_hash: string | null }>("SELECT * FROM reminders WHERE id = ? AND status = 'active'", id).toArray()[0]
    if (!row?.hook_hash || row.hook_hash !== (await sha256Hex(token))) return null
    return toReminder(row)
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
    if (status === "failed" || status === "timeout") await this.countFailure(routineId, occurrence)
    else this.sql.exec("UPDATE reminders SET fails = 0 WHERE id = ?", routineId)
  }

  // One failed run or post. At MAX_FAILS a routine pauses and a one-off fails. The human hears once per occurrence.
  private async countFailure(id: string, occurrence: string): Promise<void> {
    this.sql.exec("UPDATE reminders SET fails = fails + 1 WHERE id = ?", id)
    const reminder = this.get(id)
    if (!reminder || reminder.fails < MAX_FAILS) return
    const to = reminder.trigger ? "paused" : "failed"
    if (!this.sql.exec("UPDATE reminders SET status = ? WHERE id = ? AND status = 'active'", to, id).rowsWritten) return
    await this.rearm()
    const text = reminder.trigger
      ? `routine "${reminder.name}" paused itself: its last ${MAX_FAILS} runs failed. ask @${reminder.target} to look at it, or resume it.`
      : `reminder "${reminder.text}" did not post after ${MAX_FAILS} tries. snooze it to try again.`
    await this.ports?.notice(reminder.roomId, `${to}:${id}:${occurrence}`, text).catch((e: unknown) => console.error(`${to} notice not sent: ${e instanceof Error ? e.message : String(e)}`))
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
    if (!["task", "message", "file", "webhook"].includes(routine.trigger.on)) return null
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
      .exec<Row>("SELECT * FROM reminders WHERE room_id = ? AND status = 'active' AND json_extract(trigger, '$.on') IN ('task', 'message', 'file')", roomId)
      .toArray()
      .map(toReminder)
  }

  async devAge(ms: number): Promise<void> {
    this.sql.exec("UPDATE reminders SET due_utc = max(due_utc - ?, ?) WHERE status = 'active' AND trigger IS NULL AND target != 'human' AND due_utc > 0", ms, this.now())
    await this.rearm()
  }

  async makeDue(id: string): Promise<void> {
    this.sql.exec("UPDATE reminders SET due_utc = ? WHERE id = ? AND status = 'active' AND due_utc > 0", this.now(), id)
    await this.rearm()
  }

  async cancel(id: string): Promise<Reminder | null> {
    const changed = this.sql.exec("UPDATE reminders SET status = 'cancelled', hook_hash = NULL WHERE id = ? AND status IN ('active', 'paused')", id)
    if (!changed.rowsWritten) return null
    await this.rearm()
    return this.get(id)
  }

  /** A deleted chat takes its reminders and routines with it. Returns the webhook routines, whose lookup rows the caller drops. */
  async cancelRoom(roomId: string): Promise<string[]> {
    const hooks = this.sql
      .exec<{ id: string }>("SELECT id FROM reminders WHERE room_id = ? AND status IN ('active', 'paused', 'failed') AND json_extract(trigger, '$.on') = 'webhook'", roomId)
      .toArray()
      .map((r) => r.id)
    const changed = this.sql.exec("UPDATE reminders SET status = 'cancelled', hook_hash = NULL WHERE room_id = ? AND status IN ('active', 'paused', 'failed')", roomId)
    if (changed.rowsWritten) await this.rearm()
    return hooks
  }

  /** Drops a routine that was just created, when the wiring around it failed. */
  remove(id: string): void {
    this.sql.exec("DELETE FROM reminders WHERE id = ?", id)
  }

  /** The stored row, every column, so a wiring that failed after an update can put it back. */
  rowOf(id: string): Record<string, SqlStorageValue> | null {
    return this.sql.exec<Record<string, SqlStorageValue>>("SELECT * FROM reminders WHERE id = ?", id).toArray()[0] ?? null
  }

  /** Writes back a row from rowOf. The alarm is re-armed from the restored due time. */
  async putRow(row: Record<string, SqlStorageValue>): Promise<void> {
    const entries = Object.entries(row)
    this.sql.exec(`UPDATE reminders SET ${entries.map(([c]) => `"${c}" = ?`).join(", ")} WHERE id = ?`, ...entries.map(([, v]) => v), row.id)
    await this.rearm()
  }

  async cancelCreatedBy(createdBy: string): Promise<number> {
    const changed = this.sql.exec("UPDATE reminders SET status = 'cancelled', hook_hash = NULL WHERE created_by = ? AND status = 'active'", createdBy)
    if (changed.rowsWritten) await this.rearm()
    return changed.rowsWritten
  }

  async snooze(id: string, time: string): Promise<Reminder | null> {
    const due = parseTime(time, this.now())
    const current = this.get(id)
    if (!current || current.status === "cancelled") return null
    if (current.trigger && current.trigger.on !== "time") throw new ReminderError("snooze works on time reminders")
    // A paused routine stays paused: the human paused it, and its failures still count.
    this.sql.exec(
      "UPDATE reminders SET due_utc = ?, status = CASE WHEN status = 'paused' THEN 'paused' ELSE 'active' END, fails = CASE WHEN status = 'paused' THEN fails ELSE 0 END WHERE id = ?",
      due,
      id,
    )
    await this.rearm()
    return this.get(id)
  }

  async rewind(id: string): Promise<Reminder | null> {
    const changed = this.sql.exec(
      "UPDATE reminders SET due_utc = last_fired, status = 'active' WHERE id = ? AND last_fired IS NOT NULL AND status != 'cancelled'",
      id,
    )
    if (!changed.rowsWritten) return null
    await this.rearm()
    return this.get(id)
  }

  async fire(): Promise<void> {
    const now = this.now()
    await this.alarms.setWakeup(REMINDERS_WAKEUP, now + RETRY_MS)
    const due = this.sql
      .exec<Row>("SELECT * FROM reminders WHERE status = 'active' AND due_utc > 0 AND due_utc <= ? ORDER BY due_utc, id", now)
      .toArray()
      .map(toReminder)
    let failed = false
    let watched = 0
    let delivered = 0
    const away = this.ports?.gate.away() ?? false
    this.expireLostRuns()
    for (const reminder of due) {
      let next: number | null
      try {
        if (!reminder.trigger) {
          if ((await this.deliver(deliveryId(reminder), reminder).catch(thrownAsRefused)) === "refused") {
            await this.countFailure(reminder.id, String(reminder.dueUtc))
            failed = true
            continue
          }
          next = nextTime(reminder, this.now())
        } else if (reminder.trigger.on === "watch") {
          if (!away && ++watched > WATCHES_PER_PASS) {
            failed = true
            continue
          }
          if (!away) await this.check(reminder, reminder.trigger)
          next = nextEvery(reminder.dueUtc, reminder.trigger.everyMinutes * 60_000, this.now())
        } else {
          if (++delivered > RUNS_PER_PASS) {
            failed = true
            continue
          }
          if (this.now() - reminder.dueUtc <= LATE_MS) await this.run(reminder, String(reminder.dueUtc), "its scheduled time", "")
          next = nextTime(reminder, this.now())
        }
      } catch {
        failed = true
        continue
      }
      this.sql.exec(
        `UPDATE reminders SET last_fired = due_utc, due_utc = ?, status = ?
         WHERE id = ? AND due_utc = ? AND status = 'active'`,
        next ?? reminder.dueUtc,
        next === null ? "done" : "active",
        reminder.id,
        reminder.dueUtc,
      )
    }
    await this.rearm(failed ? this.now() + (watched > WATCHES_PER_PASS || delivered > RUNS_PER_PASS ? 1_000 : RETRY_MS) : 0)
  }

  private async check(routine: Reminder, trigger: Extract<Trigger, { on: "watch" }>): Promise<void> {
    if (!this.ports) return
    const state = JSON.parse(this.sql.exec<{ watch_state: string | null }>("SELECT watch_state FROM reminders WHERE id = ?", routine.id).one().watch_state ?? "{}") as { fp?: string; errors?: number }
    const save = (next: { fp?: string; errors?: number }) => this.sql.exec("UPDATE reminders SET watch_state = ? WHERE id = ?", JSON.stringify(next), routine.id)
    const page = await this.ports.watch(trigger)
    if (!page.ok) {
      const errors = (state.errors ?? 0) + 1
      save({ ...state, errors })
      if (errors < MAX_WATCH_ERRORS) return
      this.sql.exec("UPDATE reminders SET status = 'paused' WHERE id = ? AND status = 'active'", routine.id)
      await this.ports.notice(routine.roomId, `watch-paused:${routine.id}:${routine.dueUtc}`, `routine "${routine.name}" paused itself: ${trigger.url} failed ${errors} checks in a row (${page.error}).`)
      return
    }
    const fp = await sha256Hex(page.text)
    if (state.fp === fp && !state.errors) return
    if (state.fp !== undefined && state.fp !== fp) {
      const excerpt = page.text.length > WATCH_EXCERPT ? `${page.text.slice(0, WATCH_EXCERPT)}\n[cut at ${WATCH_EXCERPT} characters]` : page.text
      if ((await this.run(routine, `watch:${routine.dueUtc}`, `${trigger.url} changed`, `the page now:\n${excerpt}`)) === "held") return
    }
    save({ fp })
  }

  private async rearm(notBefore = 0): Promise<void> {
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

export function nextEvery(due: number, every: number, now: number): number {
  return due + Math.max(1, Math.ceil((now - due + 1) / every)) * every
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
    case "task":
      return `when a task here moves to ${trigger.status?.length ? trigger.status.join(" or ") : "any status"}`
    case "message":
      return `when ${trigger.from === "any" ? "anyone" : trigger.from === "human" ? "the human" : "an agent"} posts here${trigger.contains ? ` a message containing "${trigger.contains}"` : ""}`
    case "file":
      return `when a file under /${trigger.path.replace(/^\/+/, "")} changes`
    case "webhook":
      return `when its webhook gets a post${trigger.match?.length ? " that matches" : ""}`
    case "watch":
      return `when ${trigger.url} changes, checked every ${trigger.everyMinutes} minutes`
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
