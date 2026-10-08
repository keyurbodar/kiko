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

export function closeSockets(ctx: DurableObjectState): void {
	for (const ws of ctx.getWebSockets()) {
		try {
			ws.close(1000, "account deleted")
		} catch {
		}
	}
}

export async function wipeStorage(ctx: DurableObjectState): Promise<number> {
	const rows = await storedRows(ctx.storage)
	closeSockets(ctx)
	await ctx.storage.deleteAlarm()
	await ctx.storage.deleteAll()
	return rows
}
