export type DevCounterPort = {
  bump(key: string, n?: number): void
  instrumentation(kind: string, complete: boolean): void
  track(kind: string, cursor: SqlStorageCursor<Record<string, SqlStorageValue>>, write: boolean, sql: string): void
}

const KV = ["get", "put", "delete", "list", "setAlarm", "getAlarm", "deleteAlarm", "transaction"] as const
const MAX_LABEL = 240
const MAX_LABELS = 4_000
const labels = new Map<string, string>()

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
        port.track(kind, cursor, true, sqlLabel(query))
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
          const result = Reflect.apply(fn as (...a: unknown[]) => unknown, ctx.storage, args)
          if (name !== "put" && name !== "delete" && name !== "setAlarm") return result
          return Promise.resolve(result).then((value) => {
            if (name === "put") {
              const keys = typeof args[0] === "string" ? 1 : Object.keys(args[0] as Record<string, unknown>).length
              port.bump(`${kind}.kvKeysPut`, keys)
            } else if (name === "delete") {
              port.bump(`${kind}.kvKeysDeleted`, typeof value === "number" ? value : value === true ? 1 : 0)
            } else {
              port.bump(`${kind}.alarmWrites`)
            }
            return value
          })
        },
      })
    }
    port.instrumentation(kind, true)
  } catch (error) {
    port.instrumentation(kind, false)
    throw new Error(`Development storage instrumentation failed for ${kind}`, { cause: error })
  }
}
