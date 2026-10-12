// Written before the wipe and again after it, so an evicted object still refuses work. An in-memory flag did not survive eviction.
// `true` is a finished wipe. `DELETING` is a wipe in progress: the object refuses work but still has rows to remove.
const TOMBSTONE = "wiped"
const DELETING = "deleting"

export async function isWiped(storage: DurableObjectStorage): Promise<boolean> {
	const state = await storage.get(TOMBSTONE)
	return state === true || state === DELETING
}

async function finished(storage: DurableObjectStorage): Promise<boolean> {
	return (await storage.get(TOMBSTONE)) === true
}

// `_cf_KV` answers SQLITE_AUTH, so key-value entries are counted through the key-value API, not SQL.
// The wipe marker is not a row, so it is never counted. Rows written after a finished wipe are counted, so a probe sees residue.
export async function storedRows(storage: DurableObjectStorage): Promise<number> {
	const sql = storage.sql
	const tables = sql
		.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
		.toArray()
		.map((r) => r.name)
		.filter((name) => name !== "meta" && !name.startsWith("sqlite_") && !name.startsWith("_cf_") && !name.includes("_fts"))
	let rows = [...(await storage.list()).keys()].filter((key) => key !== TOMBSTONE).length
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

// The mark goes first, so an alarm or a receive that arrives while `shutdown` awaits does no work.
// A finished wipe does nothing, so a probe that reads a wiped object does not run `shutdown` against empty tables.
// If `shutdown` or the wipe throws, the object stays marked as deleting and the next call finishes the wipe.
export async function wipeStorage(ctx: DurableObjectState, shutdown: () => Promise<unknown> = async () => {}): Promise<number> {
	if (await finished(ctx.storage)) return 0
	const rows = await storedRows(ctx.storage)
	await ctx.storage.put(TOMBSTONE, DELETING)
	await shutdown()
	closeSockets(ctx)
	await ctx.storage.deleteAlarm()
	await ctx.storage.deleteAll()
	await ctx.storage.put(TOMBSTONE, true)
	return rows
}
