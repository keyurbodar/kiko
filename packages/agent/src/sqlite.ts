import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "@earendil-works/pi-durable/storage/sqlite"

// ASSUMPTION: pi-durable 1.0.0 binds only text, integers, and null. `ctx.storage.sql` rejects a bigint
// binding and returns a blob as an ArrayBuffer, so those two members of `SqliteValue` are not supported.
type Binding = Exclude<SqliteValue, bigint>

const ignore = () => {}

/**
 * The `SqliteDatabase` that `pi-durable` needs, over a Durable Object's own SQLite.
 *
 * `ctx.storage.sql` is synchronous. `ctx.storage.transaction()` is the only way to get a rollback
 * around an async callback, because `sql.exec` refuses BEGIN and SAVEPOINT. Every call on the
 * database is ordered: an operation issued while a transaction runs waits
 * for its commit or rollback. A transaction handle skips the chain and runs at once.
 */
export function openDurableObjectSqlite(storage: DurableObjectStorage): SqliteDatabase {
  let tail: Promise<void> = Promise.resolve()
  let closed = false

  let pending = 0
  const now = <T>(operation: () => T): Promise<T> => {
    if (pending > 0) return held(operation)
    try {
      if (closed) throw new Error("sqlite database is closed")
      return Promise.resolve(operation())
    } catch (error) {
      return Promise.reject(error)
    }
  }
  const held = <T>(operation: () => T | Promise<T>): Promise<T> => {
    pending++
    const result = tail
      .then(() => {
        if (closed) throw new Error("sqlite database is closed")
        return operation()
      })
      .finally(() => {
        pending--
      })
    tail = result.then(ignore, ignore)
    return result
  }

  const rows = <T>(sql: string, params: SqliteValue[]) =>
    storage.sql.exec<Record<string, SqlStorageValue>>(sql, ...(params as Binding[])).toArray() as T[]

  const executor = (run: <T>(operation: () => T) => Promise<T>): SqliteExecutor => ({
    exec: (sql) => run(() => void rows(sql, [])),
    run: (sql, ...params) => run(() => void rows(sql, params)),
    get: <T extends object>(sql: string, ...params: SqliteValue[]) => run(() => rows<T>(sql, params)[0] as T | undefined),
    all: <T extends object>(sql: string, ...params: SqliteValue[]) => run(() => rows<T>(sql, params)),
  })

  return {
    ...executor(now),
    transaction: (callback) =>
      held(() =>
        // A throw from the callback rolls back and rejects with the same error. Both are the
        // runtime's behavior. A rollback that fails breaks the object, so no later call succeeds.
        storage.transaction(async () => {
          let active = true
          const handle = executor(async (operation) => {
            if (!active) throw new Error("sqlite transaction handle is no longer active")
            return operation()
          })
          try {
            return await callback(handle)
          } finally {
            active = false
          }
        }),
      ),
    close: () =>
      held(() => {
        closed = true
      }),
  }
}
