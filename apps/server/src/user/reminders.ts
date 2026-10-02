import type { RoomId } from "@kiko/protocol"
import type { Env } from "../index"
import type { Alarms } from "../lib/alarm"
import { roomStub } from "../lib/names"
import { nextOccurrence } from "./recurrence"

// Architecture section 14. One scheduling mechanism: a `reminders` table in `UserDO`
// and one wakeup, `reminders`, that always points at the earliest due row.
//
// Delivery is at least once and the room makes it exactly once. Each occurrence has
// the delivery id `<reminderId>:<due_utc>`. The row moves forward only after the room
// has the message, and the room ignores an id it has seen. A crash between the two
// steps leaves the row due, the next alarm delivers the same id again, and the room
// stores nothing.

export const REMINDERS_WAKEUP = "reminders"
/** How long to wait before retrying after a failed or interrupted delivery. ASSUMPTION: the number. */
const RETRY_MS = 30_000
/** Bounds the catch-up loop for a recurring row that missed many occurrences. */
const MAX_SKIPS = 10_000
const MAX_TEXT = 2000

export type ReminderStatus = "active" | "done" | "cancelled"

export type Reminder = {
  id: string
  text: string
  /** Ms since epoch. For a recurring row, the next occurrence. */
  dueUtc: number
  tz: string
  rrule: string | null
  roomId: RoomId
  /** `human`, or an agent slug. */
  target: string
  /** `human`, or the agent slug that scheduled it. */
  createdBy: string
  status: ReminderStatus
  /** The `due_utc` of the last delivered occurrence. */
  lastFired: number | null
}

export type NewReminder = {
  text: string
  /** ISO 8601 with a `Z` or an offset. */
  time: string
  /** IANA zone. Recurrence runs on wall-clock time here. */
  tz: string
  rrule?: string
  roomId: RoomId
  target?: string
  createdBy?: string
}

/** Posts one occurrence. Returns when the room has stored it, or has seen the id before. */
export type Deliver = (deliveryId: string, reminder: Reminder) => Promise<void>

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
}

const toReminder = (r: Row): Reminder => ({
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

export const deliveryId = (r: Pick<Reminder, "id" | "dueUtc">) => `${r.id}:${r.dueUtc}`

function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/**
 * Parses an ISO time that names its offset. A bare wall time is ambiguous, so it is
 * refused. The result is rounded up to a whole second, because `rrule` works in
 * seconds and a recurring row must keep its exact step.
 */
function parseTime(time: string): number {
  if (!/(z|[+-]\d{2}:?\d{2})$/i.test(time.trim())) throw new ReminderError("time must include an offset or z")
  const at = Date.parse(time)
  if (Number.isNaN(at)) throw new ReminderError("time is not an iso date")
  return Math.ceil(at / 1000) * 1000
}

/**
 * The occurrence after `due` that is later than `now`, or null when the rule ends.
 * Each step starts from the one before, so the wall-clock time stays anchored.
 * ASSUMPTION: missed occurrences (the object was down) are skipped, not delivered late.
 */
export function nextAfter(rrule: string, tz: string, due: number, now: number): number | null {
  let at = due
  for (let i = 0; i < MAX_SKIPS; i++) {
    const next = nextOccurrence(rrule, tz, at)
    if (!next) return null
    if (next.getTime() > now) return next.getTime()
    at = next.getTime()
  }
  return null
}

/** What the RPC returns, since an error class does not survive the trip. */
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

/** The real delivery: the room of the owning user, through `names.ts`. */
export function roomDelivery(env: Env, owner: () => string | null): Deliver {
  return async (id, reminder) => {
    const userId = owner()
    if (!userId) throw new ReminderError("no owner")
    await roomStub(env.ROOM, userId, reminder.roomId).deliverReminder(id, { text: reminder.text, target: reminder.target })
  }
}

export class Reminders {
  constructor(
    private readonly sql: SqlStorage,
    private readonly alarms: Alarms,
    private readonly deliver: Deliver,
    private readonly now: () => number = Date.now,
  ) {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      due_utc INTEGER NOT NULL,
      tz TEXT NOT NULL,
      rrule TEXT,
      room_id TEXT NOT NULL,
      target TEXT NOT NULL,
      created_by TEXT NOT NULL,
      status TEXT NOT NULL,
      last_fired INTEGER,
      created_at INTEGER NOT NULL
    )`)
    this.sql.exec("CREATE INDEX IF NOT EXISTS reminders_due ON reminders (status, due_utc)")
  }

  get(id: string): Reminder | null {
    const row = this.sql.exec<Row>("SELECT * FROM reminders WHERE id = ?", id).toArray()[0]
    return row ? toReminder(row) : null
  }

  /** Active rows first by due time, then the rest, newest first. */
  list(): Reminder[] {
    return this.sql
      .exec<Row>(
        "SELECT * FROM reminders ORDER BY status = 'active' DESC, CASE WHEN status = 'active' THEN due_utc ELSE -due_utc END",
      )
      .toArray()
      .map(toReminder)
  }

  /** The user id the Worker gave this object, or null before the first reminder. */
  owner(): string | null {
    const row = this.sql.exec<{ value: string }>("SELECT value FROM settings WHERE key = 'owner'").toArray()[0]
    return row ? (JSON.parse(row.value) as string) : null
  }

  /**
   * Validates and stores a reminder. `owner` is the session's user id, set by the
   * Worker, and is what the alarm later uses to reach the room. The room must be in
   * the user's chat list.
   */
  async create(owner: string, input: NewReminder): Promise<Reminder> {
    if (this.owner() === null) {
      this.sql.exec("INSERT INTO settings (key, value) VALUES ('owner', ?)", JSON.stringify(owner))
    } else if (this.owner() !== owner) {
      throw new ReminderError("wrong owner")
    }
    if (!this.sql.exec("SELECT 1 FROM chats WHERE room_id = ?", input.roomId).toArray().length) {
      throw new ReminderError("unknown chat")
    }
    const text = input.text.trim()
    if (!text) throw new ReminderError("text is empty")
    if (text.length > MAX_TEXT) throw new ReminderError("text is too long")
    if (!validZone(input.tz)) throw new ReminderError("unknown time zone")
    const due = parseTime(input.time)
    const rrule = input.rrule?.trim() || null
    if (rrule) {
      try {
        nextOccurrence(rrule, input.tz, due)
      } catch {
        throw new ReminderError("rrule does not parse")
      }
    }
    const target = input.target?.trim() || "human"
    if (target !== "human" && !/^[a-z0-9-]{1,32}$/.test(target)) throw new ReminderError("bad target")
    const id = crypto.randomUUID()
    this.sql.exec(
      `INSERT INTO reminders (id, text, due_utc, tz, rrule, room_id, target, created_by, status, last_fired, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?)`,
      id,
      text,
      due,
      input.tz,
      rrule,
      input.roomId,
      target,
      input.createdBy ?? "human",
      this.now(),
    )
    await this.rearm()
    return this.get(id)!
  }

  /** Returns the row, or null when it does not exist or is not active. */
  async cancel(id: string): Promise<Reminder | null> {
    const changed = this.sql.exec("UPDATE reminders SET status = 'cancelled' WHERE id = ? AND status = 'active'", id)
    if (!changed.rowsWritten) return null
    await this.rearm()
    return this.get(id)
  }

  /**
   * Moves the next occurrence to `time`. A done one-off becomes active again. For a
   * recurring row the occurrences after it follow from the new time.
   */
  async snooze(id: string, time: string): Promise<Reminder | null> {
    const due = parseTime(time)
    const changed = this.sql.exec(
      "UPDATE reminders SET due_utc = ?, status = 'active' WHERE id = ? AND status != 'cancelled'",
      due,
      id,
    )
    if (!changed.rowsWritten) return null
    await this.rearm()
    return this.get(id)
  }

  /**
   * Development only. Puts a row back to the occurrence it last delivered, as if the
   * object died after the room stored the message and before the row moved. The next
   * alarm must then deliver nothing.
   */
  async rewind(id: string): Promise<Reminder | null> {
    const changed = this.sql.exec(
      "UPDATE reminders SET due_utc = last_fired, status = 'active' WHERE id = ? AND last_fired IS NOT NULL AND status != 'cancelled'",
      id,
    )
    if (!changed.rowsWritten) return null
    await this.rearm()
    return this.get(id)
  }

  /** The alarm handler. Delivers every due row once, then moves it forward or marks it done. */
  async fire(): Promise<void> {
    const now = this.now()
    // The wakeup was removed when it came due. Keep one set while delivering, so an
    // eviction in the middle still brings the alarm back.
    await this.alarms.setWakeup(REMINDERS_WAKEUP, now + RETRY_MS)
    const due = this.sql
      .exec<Row>("SELECT * FROM reminders WHERE status = 'active' AND due_utc <= ? ORDER BY due_utc, id", now)
      .toArray()
      .map(toReminder)
    let failed = false
    for (const reminder of due) {
      try {
        await this.deliver(deliveryId(reminder), reminder)
      } catch {
        failed = true // The row stays due and the retry delivers the same id.
        continue
      }
      const next = reminder.rrule ? nextAfter(reminder.rrule, reminder.tz, reminder.dueUtc, this.now()) : null
      // Only the occurrence just delivered may move. A snooze or cancel during the
      // delivery changed the row, and this update then matches nothing.
      this.sql.exec(
        `UPDATE reminders SET last_fired = due_utc, due_utc = ?, status = ?
         WHERE id = ? AND due_utc = ? AND status = 'active'`,
        next ?? reminder.dueUtc,
        next === null ? "done" : "active",
        reminder.id,
        reminder.dueUtc,
      )
    }
    await this.rearm(failed ? this.now() + RETRY_MS : 0)
  }

  /** Points the `reminders` wakeup at the earliest active row, no sooner than `notBefore`. */
  private async rearm(notBefore = 0): Promise<void> {
    const { at } = this.sql
      .exec<{ at: number | null }>("SELECT min(due_utc) AS at FROM reminders WHERE status = 'active'")
      .one()
    if (at === null) await this.alarms.clearWakeup(REMINDERS_WAKEUP)
    else await this.alarms.setWakeup(REMINDERS_WAKEUP, Math.max(at, notBefore))
  }
}
