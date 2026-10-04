import { Database } from "bun:sqlite"

/** A Durable Object `SqlStorage` over bun:sqlite, enough for code that reads rows and `rowsWritten`. */
export function sqlStorage(db = new Database(":memory:")): SqlStorage {
  return {
    exec(query: string, ...args: unknown[]) {
      const statement = db.query(query)
      const rows = statement.all(...(args as never[])) as Record<string, unknown>[]
      const changes = (db.query("SELECT changes() AS n").get() as { n: number }).n
      const written = /^\s*(insert|update|delete|replace)/i.test(query) ? changes : 0
      return { toArray: () => rows, one: () => rows[0], rowsWritten: written, [Symbol.iterator]: () => rows[Symbol.iterator]() }
    },
  } as unknown as SqlStorage
}
