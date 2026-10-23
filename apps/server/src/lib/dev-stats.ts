import type { DevCounterPort } from "./dev-stats-patch"

type StatementRow = {
  kind: string
  sql: string
  statements: number
  rowsRead: number
  rowsWritten: number
}

const counters = new Map<string, number>()
const instrumentation = new Map<string, boolean>()
const statements = new Map<string, StatementRow>()
const open: { kind: string; write: boolean; sql: string; cursor: SqlStorageCursor<Record<string, SqlStorageValue>> }[] =
  []
const MAX_OPEN = 10_000
const MAX_STATEMENTS = 500

function bump(key: string, n = 1): void {
  counters.set(key, (counters.get(key) ?? 0) + n)
}

function statementRow(kind: string, sql: string): StatementRow {
  const key = `${kind}\u0000${sql}`
  let row = statements.get(key)
  if (!row) {
    row = { kind, sql, statements: 0, rowsRead: 0, rowsWritten: 0 }
    statements.set(key, row)
  }
  return row
}

function settle(): void {
  for (const { kind, write, sql, cursor } of open.splice(0)) {
    const rowsRead = cursor.rowsRead
    const rowsWritten = cursor.rowsWritten
    bump(`${kind}.rowsRead`, rowsRead)
    if (write) {
      bump(`${kind}.rowsWritten`, rowsWritten)
      bump(`${kind}.sqlRowsWritten`, rowsWritten)
    }
    const row = statementRow(kind, sql)
    row.statements += 1
    row.rowsRead += rowsRead
    row.rowsWritten += rowsWritten
  }
}

const port: DevCounterPort = {
  bump,
  instrumentation(kind, complete) {
    instrumentation.set(kind, complete && instrumentation.get(kind) !== false)
  },
  track(kind, cursor, write, sql) {
    open.push({ kind, write, sql, cursor })
    if (open.length > MAX_OPEN) settle()
  },
}

export { bump, port }

export function proxyRpc<T extends object>(stub: T, target: string): T {
  return new Proxy(stub, {
    get(obj, key, receiver) {
      const value = Reflect.get(obj, key, receiver)
      if (typeof key !== "string" || typeof value !== "function" || key === "then") return value
      return (...args: unknown[]) => {
        bump(`rpc.${target}.${key}`)
        return Reflect.apply(value as (...a: unknown[]) => unknown, obj, args)
      }
    },
  })
}

const live = new Map<string, number>()

export async function trackInFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const now = (live.get(key) ?? 0) + 1
  live.set(key, now)
  counters.set(key, Math.max(counters.get(key) ?? 0, now))
  try {
    return await run()
  } finally {
    live.set(key, (live.get(key) ?? 1) - 1)
  }
}

function statementReport(limit = MAX_STATEMENTS): { statements: StatementRow[]; statementsOmitted: number } {
  const rows = [...statements.values()].sort(
    (a, b) =>
      b.rowsWritten - a.rowsWritten ||
      b.rowsRead - a.rowsRead ||
      b.statements - a.statements ||
      a.kind.localeCompare(b.kind) ||
      a.sql.localeCompare(b.sql),
  )
  return { statements: rows.slice(0, limit), statementsOmitted: Math.max(0, rows.length - limit) }
}

function billedWrites(values: Readonly<Record<string, number>>): {
  sqlPhysical: number
  kvKeysPut: number
  kvKeysDeleted: number
  setAlarm: number
  total: number
} {
  const sum = (suffix: string) =>
    Object.entries(values).reduce((total, [key, value]) => (key.endsWith(`.${suffix}`) ? total + value : total), 0)
  const sqlPhysical = sum("sqlRowsWritten")
  const kvKeysPut = sum("kvKeysPut")
  const kvKeysDeleted = sum("kvKeysDeleted")
  const setAlarm = sum("alarmWrites")
  return { sqlPhysical, kvKeysPut, kvKeysDeleted, setAlarm, total: sqlPhysical + kvKeysPut + kvKeysDeleted + setAlarm }
}

export function devStatsRoute(request: Request, local: boolean): Response | null {
  const url = new URL(request.url)
  if (!url.pathname.startsWith("/api/dev/stats")) return null
  if (!local) return Response.json({ error: "not found" }, { status: 404 })
  if (url.pathname === "/api/dev/stats/reset" && request.method === "POST") {
    settle()
    counters.clear()
    statements.clear()
    return Response.json({ ok: true })
  }
  if (url.pathname === "/api/dev/stats" && request.method === "GET") {
    settle()
    return Response.json({
      billingVersion: instrumentation.size > 0 && [...instrumentation.values()].every(Boolean) ? 1 : 0,
      instrumentation: Object.fromEntries(instrumentation),
      counters: Object.fromEntries([...counters].sort(([a], [b]) => a.localeCompare(b))),
      billedWrites: billedWrites(Object.fromEntries(counters)),
      ...statementReport(),
    })
  }
  return Response.json({ error: "not found" }, { status: 404 })
}
