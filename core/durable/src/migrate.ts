export type Step = string | ((sql: SqlStorage) => void)

export function migrate(storage: Pick<DurableObjectStorage, "sql" | "transactionSync">, steps: readonly Step[]): void {
  const sql = storage.sql
  storage.transactionSync(() => {
    sql.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    const row = sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'").toArray()[0]
    const from = row ? Number(row.value) : 0
    for (const step of steps.slice(from)) {
      if (typeof step === "string") sql.exec(step)
      else step(sql)
    }
    if (from < steps.length) {
      sql.exec(
        "INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        String(steps.length),
      )
    }
  })
}
