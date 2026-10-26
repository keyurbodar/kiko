import * as Schema from "effect/Schema"
import type { RoomId, RoutineRunStatus, Trigger } from "@kiko/protocol"
import type { RoutineDelivery, RoutineScheduler, ScheduledRoutine } from "../owner/schedules"
import { RRule } from "rrule"
import { sha256Hex, toHex } from "@kiko/durable/hash"
import { getSetting, setSetting } from "../lib/settings"
import { nextOccurrence, repeatProblem, validZone } from "@kiko/sandbox/recurrence"
import { MIN_REPEAT_MS, ruleProblem } from "@kiko/sandbox/rule"

const MAX_ROUTINES = 50
const YEAR_MS = 365 * 86_400_000
const RUNS_KEPT = 20
const LATE_MS = 60 * 60_000
const MAX_FAILS = 3
const LOST_RUN_MS = 2 * 60 * 60_000
const MAX_SKIPS = 10_000
const MAX_TEXT = 2000

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

export type RoutineRun = {
  routineId: string
  occurrence: string
  startedAt: number
  endedAt: number | null
  status: RoutineRunStatus
  seq: number | null
}

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

type DeliverRun = (input: {
  requestId: string
  deliveryId: string
  routine: Reminder
  body: string
}) => Promise<RunDelivery>

export type Notice = (roomId: RoomId, id: string, text: string) => Promise<void>

export type RunGate = { away(): boolean }

export class ReminderError extends Schema.TaggedError<ReminderError>()("ReminderError", {
  message: Schema.String,
}) {}

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

function parseTime(time: string, now: number): number {
  if (!/(z|[+-]\d{2}:?\d{2})$/i.test(time.trim()))
    throw new ReminderError({ message: "time must include an offset or z" })
  const at = Date.parse(time)
  if (Number.isNaN(at)) throw new ReminderError({ message: "time is not an iso date" })
  const due = Math.ceil(at / 1000) * 1000
  if (due > now + YEAR_MS) throw new ReminderError({ message: "time is more than a year away" })
  return due
}

function nextAfter(rrule: string, tz: string, due: number, now: number): number | null {
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
  private readonly deliveries = new Map<string, Set<Promise<RunDelivery>>>()

  constructor(
    private readonly sql: SqlStorage,
    private readonly scheduler: RoutineScheduler,
    private readonly now: () => number = Date.now,
    private readonly ports?: RoutinePorts,
    private readonly changed: () => void = () => {},
  ) {}

  get(id: string): Reminder | null {
    const row = this.sql.exec<Row>("SELECT * FROM reminders WHERE id = ?", id).toArray()[0]
    return row ? toReminder(row) : null
  }

  private required(id: string): Reminder {
    const reminder = this.get(id)
    if (!reminder) throw new ReminderError({ message: `no reminder ${id}` })
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

  triggered(): Reminder[] {
    return this.sql
      .exec<Row>("SELECT * FROM reminders WHERE trigger IS NOT NULL AND status IN ('active', 'paused')")
      .toArray()
      .map(toReminder)
  }

  owner(): string | null {
    const value = getSetting(this.sql, "owner")
    return value ? (JSON.parse(value) as string) : null
  }

  private claim(owner: string, roomId: string): void {
    if (this.owner() === null) {
      setSetting(this.sql, "owner", JSON.stringify(owner))
    } else if (this.owner() !== owner) {
      throw new ReminderError({ message: "wrong owner" })
    }
    if (!this.sql.exec("SELECT 1 FROM room_directory WHERE room_id = ?", roomId).toArray().length) {
      throw new ReminderError({ message: "unknown chat" })
    }
  }

  async createRoutine(owner: string, input: NewRoutine): Promise<{ routine: Reminder; token?: string }> {
    this.claim(owner, input.roomId)
    const fields = this.routineFields(input)
    const token = input.trigger.on === "webhook" ? toHex(crypto.getRandomValues(new Uint8Array(24))) : undefined
    const tokenHash = token ? await sha256Hex(token) : null
    const open = this.sql
      .exec<{ n: number }>(
        "SELECT count(*) AS n FROM reminders WHERE room_id = ? AND target = ? AND trigger IS NOT NULL AND status IN ('active', 'paused')",
        input.roomId,
        input.target,
      )
      .one().n
    if (open >= MAX_ROUTINES)
      throw new ReminderError({
        message: `@${input.target} already has ${MAX_ROUTINES} routines in this chat. cancel one first.`,
      })
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

  private routineFields(
    input: Pick<NewRoutine, "name" | "instructions" | "trigger" | "tz" | "target">,
    validateFreshness = true,
  ): { name: string; text: string; due: number; rrule: string | null } {
    const name = input.name.trim().toLowerCase().replace(/\s+/g, " ")
    if (!name || name.length > 60) throw new ReminderError({ message: "name must be 1 to 60 characters" })
    const text = input.instructions.trim()
    if (!text) throw new ReminderError({ message: "instructions are empty" })
    if (text.length > MAX_TEXT)
      throw new ReminderError({ message: `instructions are longer than ${MAX_TEXT} characters` })
    if (!/^[a-z0-9-]{1,32}$/.test(input.target))
      throw new ReminderError({ message: "a routine runs as an agent in this chat" })
    if (!validZone(input.tz)) throw new ReminderError({ message: "unknown time zone" })
    const t = input.trigger
    const now = this.now()
    switch (t.on) {
      case "time": {
        let due = parseTime(t.at, now)
        const rrule = t.rrule?.trim().replace(/^RRULE:/i, "") || null
        if (rrule) {
          checkRepeat(rrule, input.tz, due)
          if (validateFreshness && due <= now)
            due = nextAfter(rrule, input.tz, due, now) ?? fail("the rule has no time after now")
        } else if (validateFreshness && due < now - 1000)
          throw new ReminderError({ message: "that time is in the past. pick a future time." })
        return { name, text, due, rrule }
      }
      case "message":
      case "webhook":
        return { name, text, due: 0, rrule: null }
      default:
        throw new ReminderError({
          message: `its ${(t as { on: string }).on} trigger is no longer supported. give it a time, message, or webhook trigger.`,
        })
    }
  }

  async updateRoutine(
    id: string,
    patch: { name?: string; instructions?: string; trigger?: Trigger; status?: "active" | "paused" },
  ): Promise<{ routine: Reminder; token?: string } | null> {
    const current = this.get(id)
    if (
      !current?.trigger ||
      current.status === "cancelled" ||
      (current.status === "done" && patch.trigger === undefined)
    )
      return null
    const fresh =
      patch.trigger?.on === "webhook" && current.trigger.on !== "webhook"
        ? toHex(crypto.getRandomValues(new Uint8Array(24)))
        : undefined
    const freshHash = fresh ? await sha256Hex(fresh) : null
    const trigger = patch.trigger ?? current.trigger
    const retimed = patch.trigger !== undefined || (patch.status === "active" && current.status !== "active")
    const fields = this.routineFields(
      {
        name: patch.name ?? current.name ?? "",
        instructions: patch.instructions ?? current.text,
        trigger,
        tz: current.tz,
        target: current.target,
      },
      retimed,
    )
    const due = retimed ? fields.due : current.dueUtc
    const status = patch.status ?? (current.status === "done" ? "active" : current.status)
    const resetFails = patch.status === "active" || current.status === "done"
    if (
      !freshHash &&
      fields.name === current.name &&
      fields.text === current.text &&
      JSON.stringify(trigger) === JSON.stringify(current.trigger) &&
      fields.rrule === current.rrule &&
      due === current.dueUtc &&
      status === current.status &&
      (!resetFails || current.fails === 0)
    ) {
      return { routine: current }
    }
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

  byHook(hash: string): Reminder | null {
    const row = this.sql
      .exec<Row>("SELECT * FROM reminders WHERE hook_hash = ? AND status = 'active'", hash)
      .toArray()[0]
    return row ? toReminder(row) : null
  }

  runs(routineId?: string): RoutineRun[] {
    this.expireLostRuns()
    const rows = routineId
      ? this.sql
          .exec<RunRow>("SELECT * FROM routine_runs WHERE routine_id = ? ORDER BY started_at DESC", routineId)
          .toArray()
      : this.sql.exec<RunRow>("SELECT * FROM routine_runs ORDER BY started_at DESC LIMIT 200").toArray()
    return rows.map(toRun)
  }

  private expireLostRuns(): void {
    const now = this.now()
    this.sql.exec(
      "UPDATE routine_runs SET status = 'failed', ended_at = ? WHERE status = 'running' AND started_at < ?",
      now,
      now - LOST_RUN_MS,
    )
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
      this.sql.exec(
        "UPDATE routine_runs SET status = ?, ended_at = ? WHERE routine_id = ? AND occurrence = ? AND status = 'running'",
        status,
        this.now(),
        routineId,
        occurrence,
      )
    }
    this.sql.exec(
      "DELETE FROM routine_runs WHERE routine_id = ? AND occurrence NOT IN (SELECT occurrence FROM routine_runs WHERE routine_id = ? ORDER BY started_at DESC LIMIT ?)",
      routineId,
      routineId,
      RUNS_KEPT,
    )
  }

  async finishRun(
    routineId: string,
    occurrence: string,
    status: Exclude<RoutineRunStatus, "running" | "held">,
    seq: number | null,
  ): Promise<void> {
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
    else this.sql.exec("UPDATE reminders SET fails = 0 WHERE id = ? AND fails != 0", routineId)
  }

  private async countFailure(id: string, occurrence: string): Promise<void> {
    this.sql.exec("UPDATE reminders SET fails = fails + 1 WHERE id = ?", id)
    const routine = this.get(id)
    if (!routine || routine.fails < MAX_FAILS) return
    if (!this.sql.exec("UPDATE reminders SET status = 'paused' WHERE id = ? AND status = 'active'", id).rowsWritten)
      return
    await this.rearm()
    const text = `routine "${routine.name}" paused itself: its last ${MAX_FAILS} runs failed. ask @${routine.target} to look at it, or resume it.`
    await this.ports
      ?.notice(routine.roomId, `paused:${id}:${occurrence}`, text)
      .catch((e: unknown) => console.error(`paused notice not sent: ${e instanceof Error ? e.message : String(e)}`))
  }

  async runNow(id: string): Promise<RunDelivery | null> {
    const routine = this.get(id)
    if (!routine?.trigger || routine.status !== "active" || !this.ports) return null
    const n =
      this.sql
        .exec<{ n: number }>(
          "SELECT count(*) AS n FROM routine_runs WHERE routine_id = ? AND occurrence LIKE 'test:%'",
          id,
        )
        .one().n + 1
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
    if (this.get(routine.id)?.status !== "active") return "gone"
    const body = routineBody(routine, why, this.lastRun(routine.id), extra)
    const fresh = this.beginRun(routine.id, occurrence)
    const delivery = this.ports.gate.away() ? "held" : await this.deliver(routine, occurrence, body)
    if (delivery === "gone") {
      this.sql.exec("UPDATE reminders SET status = 'cancelled' WHERE id = ? AND status != 'cancelled'", routine.id)
      await this.rearm()
    }
    if (fresh && delivery === "refused") await this.countFailure(routine.id, occurrence)
    this.settleRun(routine.id, occurrence, delivery, fresh)
    return delivery
  }

  private async deliver(routine: Reminder, occurrence: string, body: string): Promise<RunDelivery> {
    if (!this.ports) return "refused"
    const pending = this.deliveries.get(routine.id) ?? new Set<Promise<RunDelivery>>()
    this.deliveries.set(routine.id, pending)
    const delivery = this.ports
      .deliverRun({
        requestId: `${routine.id}:${occurrence}`,
        deliveryId: `${routine.id}:${occurrence}`,
        routine,
        body,
      })
      .catch(thrownAsRefused)
    pending.add(delivery)
    try {
      return await delivery
    } finally {
      pending.delete(delivery)
      if (!pending.size) this.deliveries.delete(routine.id)
    }
  }

  private lastRun(routineId: string): RoutineRun | null {
    const row = this.sql
      .exec<RunRow>(
        "SELECT * FROM routine_runs WHERE routine_id = ? AND status != 'running' ORDER BY started_at DESC LIMIT 1",
        routineId,
      )
      .toArray()[0]
    return row ? toRun(row) : null
  }

  roomRoutines(roomId: string): Reminder[] {
    return this.sql
      .exec<Row>(
        "SELECT * FROM reminders WHERE room_id = ? AND status = 'active' AND json_extract(trigger, '$.on') = 'message'",
        roomId,
      )
      .toArray()
      .map(toReminder)
  }

  async makeDue(id: string): Promise<void> {
    const now = this.now()
    const changed = this.sql.exec(
      "UPDATE reminders SET due_utc = ? WHERE id = ? AND status = 'active' AND due_utc > 0 AND due_utc != ?",
      now,
      id,
      now,
    )
    if (changed.rowsWritten) await this.rearm()
  }

  async cancel(id: string): Promise<Reminder | null> {
    const current = this.get(id)
    if (!current || current.status === "cancelled") return current
    this.sql.exec("UPDATE reminders SET status = 'cancelled', hook_hash = NULL WHERE id = ?", id)
    await this.rearm()
    return this.get(id)
  }

  async deleteRoutine(id: string): Promise<void> {
    this.purge([id])
    await Promise.all(this.deliveries.get(id) ?? [])
    await this.rearm()
  }

  async cancelRoom(roomId: string): Promise<void> {
    this.purge(
      this.sql
        .exec<{ id: string }>("SELECT id FROM reminders WHERE room_id = ?", roomId)
        .toArray()
        .map((row) => row.id),
    )
    await this.rearm()
  }

  async cancelAgent(slug: string, roomId?: string): Promise<void> {
    this.purge(
      this.sql
        .exec<{ id: string }>(
          "SELECT id FROM reminders WHERE (target = ?1 OR created_by = ?1) AND (?2 IS NULL OR room_id = ?2)",
          slug,
          roomId ?? null,
        )
        .toArray()
        .map((row) => row.id),
    )
    await this.rearm()
  }

  private purge(ids: string[]): void {
    if (!ids.length) return
    const list = JSON.stringify(ids)
    this.sql.exec("DELETE FROM routine_runs WHERE routine_id IN (SELECT value FROM json_each(?))", list)
    this.sql.exec("DELETE FROM recipe_links WHERE routine_id IN (SELECT value FROM json_each(?))", list)
    this.sql.exec("DELETE FROM reminders WHERE id IN (SELECT value FROM json_each(?))", list)
  }

  async cancelCreatedBy(createdBy: string): Promise<number> {
    const changed = this.sql.exec(
      "UPDATE reminders SET status = 'cancelled', hook_hash = NULL WHERE created_by = ? AND status = 'active'",
      createdBy,
    )
    if (changed.rowsWritten) await this.rearm()
    return changed.rowsWritten
  }

  scheduled(): ScheduledRoutine[] {
    return this.sql
      .exec<{ id: string; due_utc: number; room_id: string; target: string }>(
        "SELECT id, due_utc, room_id, target FROM reminders WHERE status = 'active' AND due_utc > 0 AND json_extract(trigger, '$.on') = 'time' ORDER BY due_utc, id",
      )
      .toArray()
      .map((row) => ({ routineId: row.id, runAt: row.due_utc, roomId: row.room_id, target: row.target }))
  }

  async fireScheduled({ routineId, runAt, requestId }: RoutineDelivery): Promise<void> {
    const routine = this.get(routineId)
    if (routine?.status !== "active" || routine.trigger?.on !== "time" || routine.dueUtc !== runAt) {
      await this.rearm()
      return
    }
    if (this.now() < runAt) return
    if (requestId !== `${routineId}:${runAt}`) throw new ReminderError({ message: "invalid routine requestId" })
    this.expireLostRuns()
    if (routine.rrule === null || this.now() - runAt <= LATE_MS)
      await this.run(routine, String(runAt), "its scheduled time", "")
    const next = nextTime(routine, this.now())
    this.sql.exec(
      `UPDATE reminders SET last_fired = due_utc, due_utc = ?, status = ?
       WHERE id = ? AND due_utc = ? AND status = 'active'`,
      next ?? runAt,
      next === null ? "done" : "active",
      routineId,
      runAt,
    )
    await this.rearm()
  }

  async rearm(): Promise<void> {
    this.changed()
    await this.scheduler.sync(this.scheduled())
  }
}

type RunRow = {
  routine_id: string
  occurrence: string
  started_at: number
  ended_at: number | null
  status: string
  seq: number | null
}

function toRun(r: RunRow): RoutineRun {
  return {
    routineId: r.routine_id,
    occurrence: r.occurrence,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    status: r.status as RoutineRunStatus,
    seq: r.seq,
  }
}

function fail(message: string): never {
  throw new ReminderError({ message: message })
}

function thrownAsRefused(e: unknown): "refused" {
  console.error(`delivery refused: ${e instanceof Error ? e.message : String(e)}`)
  return "refused"
}

function checkRepeat(rrule: string, tz: string, from: number): void {
  const problem = repeatProblem(rrule, tz, from)
  if (problem) throw new ReminderError({ message: problem })
}

function nextTime(r: Pick<Reminder, "rrule" | "tz" | "dueUtc">, now: number): number | null {
  return r.rrule ? nextAfter(r.rrule, r.tz, r.dueUtc, Math.max(now, r.dueUtc + MIN_REPEAT_MS - 1)) : null
}

export function localTime(at: number, tz: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(at))
      .map((x) => [x.type, x.value]),
  )
  return `${p.weekday}, ${p.month} ${p.day} at ${p.hour}:${p.minute}`.toLowerCase()
}

function ruleText(rrule: string): string {
  try {
    return RRule.fromString(rrule.replace(/^RRULE:/i, ""))
      .toText()
      .toLowerCase()
  } catch {
    return rrule.toLowerCase()
  }
}

export function describeTrigger(trigger: Trigger, tz: string, due: number): string {
  switch (trigger.on) {
    case "time":
      return trigger.rrule
        ? `${ruleText(trigger.rrule)}, next ${localTime(due, tz)} (${tz})`
        : `once, ${localTime(due, tz)} (${tz})`
    case "message":
      return `when the human posts here${trigger.contains ? ` a message containing "${trigger.contains}"` : ""}`
    case "webhook":
      return `when its webhook gets a post${trigger.match?.length ? " that matches" : ""}`
    default:
      return "a trigger kiko no longer supports. it is paused"
  }
}

function routineBody(routine: Reminder, why: string, last: RoutineRun | null, extra: string): string {
  const trigger = routine.trigger
  if (!trigger) throw new ReminderError({ message: "routine has no trigger" })
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
