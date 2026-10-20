// The keyed lists the user socket carries beyond chats, agents, and the drive (`@kiko/protocol`
// rows.ts). A writer never builds a row event. It says which kind changed, the user object reads
// that kind's truth, and `diffRows` compares it with what clients were last told, kept in
// `user_rows`. Each difference becomes one event. A missed call is caught by the next one or the
// next `hello`, and a doubled call finds nothing to send.

import type { RowKind, RowLists, UserRows } from "@kiko/protocol"
import { ROW_KINDS } from "@kiko/protocol"

export type RowChange = { [K in RowKind]: { t: "row"; kind: K; row: UserRows[K] } }[RowKind] | { t: "row_removed"; kind: RowKind; id: string }

/** Records `rows` as the truth for `kind` and returns what changed since the last call. */
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

/** Every kind's rows as clients were last told, for a snapshot. */
export function rowLists(sql: SqlStorage): RowLists {
	const lists: Record<string, unknown[]> = Object.fromEntries(ROW_KINDS.map((k) => [k, []]))
	for (const r of sql.exec<{ kind: string; body: string }>("SELECT kind, body FROM user_rows ORDER BY rowid").toArray()) lists[r.kind]?.push(JSON.parse(r.body))
	return lists as RowLists
}
