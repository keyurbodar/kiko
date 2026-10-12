// The dev counters patch the object's storage so `verify` counts statements, rows read and written, and
// KV calls. Reached only through dev-guard's `instrumentDev`, so the patch never enters a production bundle.

export type DevCounterPort = {
  bump(key: string, n?: number): void
  track(kind: string, cursor: SqlStorageCursor<Record<string, SqlStorageValue>>, write: boolean): void
}

const KV = ["get", "put", "delete", "list", "setAlarm", "getAlarm", "deleteAlarm", "transaction"] as const

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
        port.track(kind, cursor, !/^\s*(SELECT|PRAGMA)/i.test(query))
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
