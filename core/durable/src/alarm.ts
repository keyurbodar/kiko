import type { Step } from "./migrate"

export const MAX_WAKEUPS = 1_000

export class WakeupLimitError extends Error {
  constructor() {
    super(`too many wakeups (limit ${MAX_WAKEUPS})`)
    this.name = "WakeupLimitError"
  }
}

export interface Alarms {
  setWakeup(key: string, at: number): Promise<void>
  clearWakeup(key: string): Promise<void>
  dueWakeups(now: number): Promise<string[]>
}

// Every object that calls createAlarms spreads this into its schema list.
export const ALARM_STEPS: Step[] = ["CREATE TABLE IF NOT EXISTS wakeups (key TEXT PRIMARY KEY, at INTEGER NOT NULL)"]

export function createAlarms(ctx: DurableObjectState): Alarms {
  const sql = ctx.storage.sql

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
        return due.map((r) => r.key)
      })
      await arm()
      return keys
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
