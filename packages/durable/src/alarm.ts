export const MAX_WAKEUPS = 1_000
export const HISTORY_LIMIT = 100

export class WakeupLimitError extends Error {
  constructor() {
    super(`too many wakeups (limit ${MAX_WAKEUPS})`)
    this.name = "WakeupLimitError"
  }
}

export type FiredWakeup = { key: string; at: number; firedAt: number }

export interface Alarms {
  setWakeup(key: string, at: number): Promise<void>
  clearWakeup(key: string): Promise<void>
  dueWakeups(now: number): Promise<string[]>
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
        // Setting a wakeup to the time it already has writes nothing: rows written are billed.
        sql.exec("INSERT INTO wakeups (key, at) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at WHERE at != excluded.at", key, at)
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

export const WAKEUP_RETRY_MS = 30_000

export async function runDue(
  alarms: Alarms,
  due: readonly string[],
  handlers: Readonly<Record<string, () => unknown>>,
  options: { retryMs?: Readonly<Record<string, number>>; now?: () => number } = {},
): Promise<string[]> {
  const now = options.now ?? Date.now
  const failed: string[] = []
  for (const [key, handler] of Object.entries(handlers)) {
    if (!due.includes(key)) continue
    try {
      await handler()
    } catch (error) {
      failed.push(key)
      console.error(`wakeup ${key} failed: ${error instanceof Error ? error.message : String(error)}`)
      await alarms.setWakeup(key, now() + (options.retryMs?.[key] ?? WAKEUP_RETRY_MS))
    }
  }
  return failed
}
