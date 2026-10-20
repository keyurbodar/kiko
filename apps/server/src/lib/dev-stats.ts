// Under `wrangler dev` every object of one Worker shares one isolate, so this module-level table sees them all.

import type { DevCounterPort } from "./dev-stats-patch"

type StatementRow = {
  kind: string
  sql: string
  statements: number
  rowsRead: number
  rowsWritten: number
}

const counters = new Map<string, number>()
// One row per (object, normalized statement). The label never holds a binding, so a parameter value cannot
// reach the stats route.
const statements = new Map<string, StatementRow>()
const open: { kind: string; write: boolean; sql: string; cursor: SqlStorageCursor<Record<string, SqlStorageValue>> }[] = []
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

// The cursor's row counts are only reliable once it has drained, so every statement is settled later, in one
// pass. The totals still add each cursor exactly once; the per-statement rows are the same numbers split by
// label.
function settle(): void {
  for (const { kind, write, sql, cursor } of open.splice(0)) {
    const rowsRead = cursor.rowsRead
    const rowsWritten = cursor.rowsWritten
    bump(`${kind}.rowsRead`, rowsRead)
    if (write) bump(`${kind}.rowsWritten`, rowsWritten)
    const row = statementRow(kind, sql)
    row.statements += 1
    row.rowsRead += rowsRead
    row.rowsWritten += rowsWritten
  }
}

// The storage patch is dev-only and lives in dev-stats-patch.ts; the fold in dev-guard drops it from a
// production bundle. A dev build wires the patch to these counters through one port.
const port: DevCounterPort = {
  bump,
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

// Records the most calls of one key running at once, as a counter that holds the peak until the next reset.
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
    (a, b) => b.rowsWritten - a.rowsWritten || b.rowsRead - a.rowsRead || b.statements - a.statements || a.kind.localeCompare(b.kind) || a.sql.localeCompare(b.sql),
  )
  return { statements: rows.slice(0, limit), statementsOmitted: Math.max(0, rows.length - limit) }
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
      counters: Object.fromEntries([...counters].sort(([a], [b]) => a.localeCompare(b))),
      ...statementReport(),
    })
  }
  return Response.json({ error: "not found" }, { status: 404 })
}
