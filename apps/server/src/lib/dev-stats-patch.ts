// The dev counters patch the object's storage so `verify` counts statements, rows read and written, and
// KV calls. Reached only through dev-guard's `instrument`, so the patch never enters a production bundle.

export type DevCounterPort = {
  bump(key: string, n?: number): void
  track(kind: string, cursor: SqlStorageCursor<Record<string, SqlStorageValue>>, write: boolean, sql: string): void
}

const KV = ["get", "put", "delete", "list", "setAlarm", "getAlarm", "deleteAlarm", "transaction"] as const
const READ = /^\s*(SELECT|PRAGMA)/i
const MAX_LABEL = 240
const MAX_LABELS = 4_000
const labels = new Map<string, string>()

/**
 * One SQL statement as a stable label for the dev counters. Scope prefixes (`s<hex>_`, the physical table
 * name that owner/context.ts rewrites in) and SQL string literals drop out, numbers become placeholders, and
 * whitespace collapses, so two runs of the same statement share one label. Bindings are never part of the
 * query text, so a parameter value cannot appear here.
 */
function sqlLabel(query: string): string {
  const cached = labels.get(query)
  if (cached !== undefined) return cached
  const label = query
    .replace(/'(?:''|[^'])*'|--[^\n]*|\/\*[\s\S]*?\*\//g, "?")
    .replace(/\bs[0-9a-f]{8,}_/gi, "")
    .replace(/\b\d+\b/g, "?")
    .replace(/\s+/g, " ")
    .trim()
  const bounded = label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL)}...` : label
  if (labels.size >= MAX_LABELS) labels.clear()
  labels.set(query, bounded)
  return bounded
}

export function patchStorage(ctx: DurableObjectState, kind: string, port: DevCounterPort): void {
  const storage = ctx.storage as unknown as Record<string, unknown>
  const sql = ctx.storage.sql
  const exec = sql.exec.bind(sql)
  try {
    Object.defineProperty(sql, "exec", {
      configurable: true,
      value: (query: string, ...bindings: SqlStorageValue[]) => {
        const cursor = exec(query, ...bindings)
        port.bump(`${kind}.statements`)
        port.track(kind, cursor, !READ.test(query), sqlLabel(query))
        return cursor
      },
    })
    for (const name of KV) {
      const fn = storage[name]
      if (typeof fn !== "function") continue
      Object.defineProperty(storage, name, {
        configurable: true,
        value: (...args: unknown[]) => {
          port.bump(`${kind}.kv.${name}`)
          return Reflect.apply(fn as (...a: unknown[]) => unknown, ctx.storage, args)
        },
      })
    }
  } catch {
    // Some runtimes expose storage as a frozen object (or a read-only property). The counters then read
    // zero for this object. Keep the dev server running rather than fail its constructor.
  }
}
