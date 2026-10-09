// Experiment 2. Counts the rows a Durable Object's SQLite reads and writes, from the cursor of every
// statement. It wraps the storage handed to `openDurableObjectSqlite`, so the facade is not edited.
// Only `sql.exec(...).toArray()` is counted, which is all the facade calls. Key-value `put` calls are
// not counted. Switched on by the `YUKI_DEBUG_ROWS` variable.

export interface RowCounts {
  rowsRead: number
  rowsWritten: number
  statements: number
}

export function countRows(storage: DurableObjectStorage): { storage: DurableObjectStorage; snapshot(): RowCounts } {
  const counts: RowCounts = { rowsRead: 0, rowsWritten: 0, statements: 0 }
  const sql = {
    exec: (query: string, ...bindings: unknown[]) => {
      const cursor = storage.sql.exec(query, ...(bindings as never[]))
      return {
        toArray: () => {
          const rows = cursor.toArray()
          counts.rowsRead += cursor.rowsRead
          counts.rowsWritten += cursor.rowsWritten
          counts.statements += 1
          return rows
        },
      }
    },
  }
  const wrapped = new Proxy(storage, {
    get(target, key) {
      if (key === "sql") return sql
      const value = Reflect.get(target, key, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  return { storage: wrapped, snapshot: () => ({ ...counts }) }
}
