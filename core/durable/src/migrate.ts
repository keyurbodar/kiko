import * as Schema from "effect/Schema"

export type Step = string | ((sql: SqlStorage) => void)

export class SchemaVersionAheadError extends Schema.TaggedError<SchemaVersionAheadError>()("SchemaVersionAheadError", {
  stored: Schema.Number,
  known: Schema.Number,
  message: Schema.String,
}) {}

function storedVersion(row: { value: string } | undefined): number {
  if (!row) return 0
  const parsed = Number(row.value)
  return Number.isInteger(parsed) ? Math.max(parsed, 0) : 0
}

export function migrate(storage: Pick<DurableObjectStorage, "sql" | "transactionSync">, steps: readonly Step[]): void {
  const sql = storage.sql
  storage.transactionSync(() => {
    sql.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    const row = sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'").toArray()[0]
    const from = storedVersion(row)
    if (from > steps.length)
      throw new SchemaVersionAheadError({
        stored: from,
        known: steps.length,
        message: `This database is at schema version ${from}, but this build only knows ${steps.length}. Update Kiko before starting it.`,
      })
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
