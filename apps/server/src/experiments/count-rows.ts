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
