import { Database } from "bun:sqlite"
import { migrate, type Step } from "@yuki/durable/migrate"

export function sqlStorage(db = new Database(":memory:")): SqlStorage {
  return {
    exec(query: string, ...args: unknown[]) {
      // A migration is several statements in one string, which only `exec` runs.
      if (!args.length && /;\s*\S/.test(query.replace(/--[^\n]*/g, ""))) {
        db.exec(query)
        return { toArray: () => [], one: () => undefined, rowsWritten: 0, [Symbol.iterator]: () => [][Symbol.iterator]() }
      }
      const statement = db.query(query)
      const rows = statement.all(...(args as never[])) as Record<string, unknown>[]
      const changes = (db.query("SELECT changes() AS n").get() as { n: number }).n
      const written = /^\s*(insert|update|delete|replace)/i.test(query) ? changes : 0
      return { toArray: () => rows, one: () => rows[0], rowsWritten: written, [Symbol.iterator]: () => rows[Symbol.iterator]() }
    },
  } as unknown as SqlStorage
}

// The tables an object creates from its schema list, on the shim. A test that builds a class over this
// storage gets the tables its object would have, and a db that already holds an older shape is upgraded.
export function sqlWith(steps: readonly Step[], db?: Database): SqlStorage {
  const sql = sqlStorage(db)
  migrate({ sql, transactionSync: <T>(fn: () => T) => fn() } as unknown as DurableObjectStorage, steps)
  return sql
}
