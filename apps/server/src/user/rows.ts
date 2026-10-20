import type { RowKind, RowLists, UserRows } from "@kiko/protocol"
import { ROW_KINDS } from "@kiko/protocol"

export type RowChange = { [K in RowKind]: { t: "row"; kind: K; row: UserRows[K] } }[RowKind] | { t: "row_removed"; kind: RowKind; id: string }

export function diffRows<K extends RowKind>(sql: SqlStorage, kind: K, rows: readonly UserRows[K][]): RowChange[] {
	const told = new Map(sql.exec<{ id: string; body: string }>("SELECT id, body FROM user_rows WHERE kind = ?", kind).toArray().map((r) => [r.id, r.body]))
	const changes: RowChange[] = []
	for (const row of rows) {
		const body = JSON.stringify(row)
		if (told.get(row.id) !== body) {
			sql.exec("INSERT OR REPLACE INTO user_rows (kind, id, body) VALUES (?, ?, ?)", kind, row.id, body)
			changes.push({ t: "row", kind, row } as RowChange)
		}
		told.delete(row.id)
	}
	for (const id of told.keys()) {
		sql.exec("DELETE FROM user_rows WHERE kind = ? AND id = ?", kind, id)
		changes.push({ t: "row_removed", kind, id })
	}
	return changes
}

export function rowLists(sql: SqlStorage): RowLists {
	const lists: Record<string, unknown[]> = Object.fromEntries(ROW_KINDS.map((k) => [k, []]))
	for (const r of sql.exec<{ kind: string; body: string }>("SELECT kind, body FROM user_rows ORDER BY kind, id").toArray()) lists[r.kind]?.push(JSON.parse(r.body))
	return lists as RowLists
}
