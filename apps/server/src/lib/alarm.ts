// One Durable Object has one alarm. This helper multiplexes it: many named
// wakeups live in a table and the alarm always points at the earliest row.

export interface Alarms {
  /** Sets or moves the wakeup for `key` to `at` (ms since epoch). */
  setWakeup(key: string, at: number): Promise<void>
  /** Removes the wakeup for `key`, if any. */
  clearWakeup(key: string): Promise<void>
  /** Returns keys with `at <= now` and removes them in one transaction. Re-arms the alarm for what remains. */
  dueWakeups(now: number): Promise<string[]>
}

export function createAlarms(ctx: DurableObjectState): Alarms {
  const sql = ctx.storage.sql
  sql.exec("CREATE TABLE IF NOT EXISTS wakeups (key TEXT PRIMARY KEY, at INTEGER NOT NULL)")

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
      sql.exec("INSERT INTO wakeups (key, at) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at", key, at)
      await arm()
    },
    async clearWakeup(key) {
      sql.exec("DELETE FROM wakeups WHERE key = ?", key)
      await arm()
    },
    async dueWakeups(now) {
      const keys = ctx.storage.transactionSync(() => {
        const due = sql.exec<{ key: string }>("SELECT key FROM wakeups WHERE at <= ? ORDER BY at, key", now).toArray()
        sql.exec("DELETE FROM wakeups WHERE at <= ?", now)
        return due.map((r) => r.key)
      })
      await arm()
      return keys
    },
  }
}
