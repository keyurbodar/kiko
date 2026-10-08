// Account deletion (P9-02), architecture section 7.9. Each Durable Object wipes its own
// storage through this helper. A wiped object keeps running until it is evicted, but its
// tables are gone, so the object remembers the wipe in memory and answers later calls
// with nothing.

/**
 * The number of stored rows that hold user data. Bookkeeping that every start recreates
 * is left out: `meta`, SQLite and Cloudflare internals, and FTS indexes, which mirror a
 * table already counted. Key-value entries count too; SQL may not read their table
 * (`_cf_KV` answers SQLITE_AUTH), so they are counted through the key-value API.
 * A freshly started, empty object counts 0.
 */
export async function storedRows(storage: DurableObjectStorage): Promise<number> {
	const sql = storage.sql
	const tables = sql
		.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
		.toArray()
		.map((r) => r.name)
		.filter((name) => name !== "meta" && !name.startsWith("sqlite_") && !name.startsWith("_cf_") && !name.includes("_fts"))
	let rows = (await storage.list()).size
	for (const name of tables) {
		rows += sql.exec<{ n: number }>(`SELECT count(*) AS n FROM "${name.replaceAll('"', '""')}"`).one().n
	}
	return rows
}

/** Closes every socket the object holds. A socket that sent nothing more never wakes it again. */
export function closeSockets(ctx: DurableObjectState): void {
	for (const ws of ctx.getWebSockets()) {
		try {
			ws.close(1000, "account deleted")
		} catch {
			// already closed
		}
	}
}

/**
 * Closes every socket, clears the alarm, and deletes all storage. Returns the rows that
 * held data, so a second wipe of the same object reports 0. Safe to call twice.
 */
export async function wipeStorage(ctx: DurableObjectState): Promise<number> {
	const rows = await storedRows(ctx.storage)
	closeSockets(ctx)
	await ctx.storage.deleteAlarm()
	await ctx.storage.deleteAll()
	return rows
}
