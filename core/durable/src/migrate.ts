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

// The mirror of addColumn, for a column the code no longer writes and that would reject an insert without it.
export function dropColumn(table: string, column: string): Step {
	return (sql) => {
		const columns = sql.exec<{ name: string }>(`PRAGMA table_info(${table})`).toArray().map((c) => c.name)
		if (columns.includes(column)) sql.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`)
	}
}

/**
 * Rebuilds a table into a new shape, keeping its rows. SQLite has no way to change a primary key, to remove
 * AUTOINCREMENT, or to make a table WITHOUT ROWID, so the only way is to write the table again.
 *
 * `create` is the whole statement for the new table, which must already carry `next` as its name. `columns` is
 * the column list both tables share. `indexes` names the indexes to drop with the old table and `recreate`
 * writes them again against the new one. The rename happens last, so a reader in the same transaction never
 * sees a missing table.
 *
 * `keep` is an optional SQL condition on the old table's columns. A rebuild of an unbounded table is one large
 * write, and a table whose old rows can never be read again should not be carried across: the free plan bills
 * every row, so a migration that copies a long-dead window can spend a day's allowance in one transaction.
 */
export function rebuildTable(
	table: string,
	next: string,
	create: string,
	columns: readonly string[],
	indexes: readonly string[],
	recreate: readonly string[],
	keep?: string,
): Step {
	return (sql) => {
		const list = columns.join(", ")
		sql.exec(create)
		sql.exec(`INSERT INTO ${next} (${list}) SELECT ${list} FROM ${table}${keep ? ` WHERE ${keep}` : ""}`)
		sql.exec(`DROP TABLE ${table}`)
		sql.exec(`ALTER TABLE ${next} RENAME TO ${table}`)
		for (const index of indexes) sql.exec(`DROP INDEX IF EXISTS ${index}`)
		for (const statement of recreate) sql.exec(statement)
	}
}
