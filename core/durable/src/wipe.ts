// `_cf_KV` answers SQLITE_AUTH, so key-value entries are counted through the key-value API, not SQL.
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
