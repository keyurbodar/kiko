// One Durable Object has one alarm. This helper multiplexes it: many named
// wakeups live in a table and the alarm always points at the earliest row.
// Architecture section 23 (Rivet `actor/schedule.rs`): due wakeups are claimed in one
// transaction, one object holds at most `MAX_WAKEUPS` keys, and the last
// `HISTORY_LIMIT` fired keys are kept with their times for debugging.

/** The most wakeup keys one object may hold. Moving an existing key is always allowed. */
export const MAX_WAKEUPS = 1_000
/** Fired wakeups kept for debugging. */
export const HISTORY_LIMIT = 100

/** Thrown by `setWakeup` for a new key when the object already holds `MAX_WAKEUPS`. */
export class WakeupLimitError extends Error {
  constructor() {
    super(`too many wakeups (limit ${MAX_WAKEUPS})`)
    this.name = "WakeupLimitError"
  }
}

/** One fired wakeup: when it was due and when the alarm claimed it. */
export type FiredWakeup = { key: string; at: number; firedAt: number }

export interface Alarms {
  /** Sets or moves the wakeup for `key` to `at` (ms since epoch). Throws `WakeupLimitError` for a new key past the cap. */
  setWakeup(key: string, at: number): Promise<void>
  /** Removes the wakeup for `key`, if any. */
  clearWakeup(key: string): Promise<void>
  /** Returns keys with `at <= now` and removes them in one transaction. Re-arms the alarm for what remains. */
  dueWakeups(now: number): Promise<string[]>
  /** The last fired wakeups, newest first. */
  history(): FiredWakeup[]
}

export function createAlarms(ctx: DurableObjectState): Alarms {
  const sql = ctx.storage.sql
  sql.exec("CREATE TABLE IF NOT EXISTS wakeups (key TEXT PRIMARY KEY, at INTEGER NOT NULL)")
  sql.exec(
    "CREATE TABLE IF NOT EXISTS wakeup_history (id INTEGER PRIMARY KEY, key TEXT NOT NULL, at INTEGER NOT NULL, fired_at INTEGER NOT NULL)",
  )

  // Points the alarm at the earliest row. Skips setAlarm when it is already right,
  // because every setAlarm call is a billed row write.
  async function arm(): Promise<void> {
    const row = sql.exec<{ at: number | null }>("SELECT min(at) AS at FROM wakeups").one()
    const current = await ctx.storage.getAlarm()
    if (row.at === null) {
      if (current !== null) await ctx.storage.deleteAlarm()
      return
    }
    if (current !== row.at) await ctx.storage.setAlarm(row.at)
  }

  return {
    async setWakeup(key, at) {
      ctx.storage.transactionSync(() => {
        const exists = sql.exec("SELECT 1 FROM wakeups WHERE key = ?", key).toArray().length > 0
        if (!exists && sql.exec<{ n: number }>("SELECT count(*) AS n FROM wakeups").one().n >= MAX_WAKEUPS) {
          throw new WakeupLimitError()
        }
        sql.exec("INSERT INTO wakeups (key, at) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at", key, at)
      })
      await arm()
    },
    async clearWakeup(key) {
      sql.exec("DELETE FROM wakeups WHERE key = ?", key)
      await arm()
    },
    async dueWakeups(now) {
      const keys = ctx.storage.transactionSync(() => {
        const due = sql.exec<{ key: string; at: number }>("SELECT key, at FROM wakeups WHERE at <= ? ORDER BY at, key", now).toArray()
        sql.exec("DELETE FROM wakeups WHERE at <= ?", now)
        for (const row of due) sql.exec("INSERT INTO wakeup_history (key, at, fired_at) VALUES (?, ?, ?)", row.key, row.at, now)
        if (due.length) {
          sql.exec("DELETE FROM wakeup_history WHERE id <= (SELECT max(id) FROM wakeup_history) - ?", HISTORY_LIMIT)
        }
        return due.map((r) => r.key)
      })
      await arm()
      return keys
    },
    history() {
      return sql
        .exec<FiredWakeup>(`SELECT key, at, fired_at AS firedAt FROM wakeup_history ORDER BY id DESC LIMIT ${HISTORY_LIMIT}`)
        .toArray()
    },
  }
}
