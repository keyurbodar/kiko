// One schema step: a SQL string, or a function for a change that must look at the table first.
export type Step = string | ((sql: SqlStorage) => void)

// Runs the steps the object has not run yet, in one transaction, and records how many have run.
// An object with no recorded version starts at step 0, so every step must be safe on a table that
// already exists: CREATE ... IF NOT EXISTS, or addColumn. A list only grows at its end.
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

// SQLite has no ADD COLUMN IF NOT EXISTS. An object whose table predates the column gets it here, appended at the end.
export function addColumn(table: string, column: string, definition: string): Step {
	return (sql) => {
		const columns = sql.exec<{ name: string }>(`PRAGMA table_info(${table})`).toArray().map((c) => c.name)
		if (!columns.includes(column)) sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
	}
}
