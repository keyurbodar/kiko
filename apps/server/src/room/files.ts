// The room's file index. Architecture section 18.1. R2 holds the bytes and this
// table holds what the room knows about them. Every change is one `file` event in
// the log, stored in the same transaction as the row.

import type { Actor, FileRef, RoomEvent } from "@kiko/protocol"
import { actorKey, type RoomLog } from "./log"

type FileRow = {
	id: string
	path: string
	r2_key: string
	size: number
	type: string
	sha256: string
	width: number | null
	height: number | null
	thumbhash: string | null
	author: string
}

/** What the Worker stored in R2 and asks the room to index. */
export type NewFile = {
	id: string
	path: string
	r2Key: string
	size: number
	type: string
	sha256: string
	author: Actor
}

export type PutResult = {
	file: FileRef
	/** An R2 key nothing points to any more. The caller deletes it. */
	drop: string | null
	event: RoomEvent | null
}

// ASSUMPTION: a FileRef's `name` is the full path in the room's file space. The
// protocol has no separate path field, and a path is unique within a room.
function toRef(r: FileRow): FileRef {
	return {
		id: r.id,
		name: r.path,
		size: r.size,
		type: r.type,
		...(r.width !== null ? { width: r.width } : {}),
		...(r.height !== null ? { height: r.height } : {}),
		...(r.thumbhash !== null ? { thumbhash: r.thumbhash } : {}),
	}
}

/** Every file in the room, by path. The snapshot uses it. */
export function listFiles(storage: DurableObjectStorage): FileRef[] {
	return storage.sql.exec<FileRow>("SELECT * FROM ws_files ORDER BY path").toArray().map(toRef)
}

export class RoomFiles {
	constructor(
		private readonly storage: DurableObjectStorage,
		private readonly log: RoomLog,
	) {}

	private get sql() {
		return this.storage.sql
	}

	private row(column: "id" | "path", value: string): FileRow | null {
		return this.sql.exec<FileRow>(`SELECT * FROM ws_files WHERE ${column} = ?`, value).toArray()[0] ?? null
	}

	/**
	 * Indexes an object the Worker stored. Safe to call twice with the same id.
	 * The same bytes at the same path keep the first row, and the new object is
	 * returned as `drop`. Other bytes at an existing path replace the row, and the
	 * old object is returned as `drop`.
	 */
	put(input: NewFile): PutResult {
		return this.storage.transactionSync(() => {
			const same = this.row("id", input.id)
			if (same) return { file: toRef(same), drop: null, event: null }
			const current = this.row("path", input.path)
			if (current?.sha256 === input.sha256) return { file: toRef(current), drop: input.r2Key, event: null }
			const author = actorKey(input.author)
			const row: FileRow = {
				id: input.id,
				path: input.path,
				r2_key: input.r2Key,
				size: input.size,
				type: input.type,
				sha256: input.sha256,
				width: null,
				height: null,
				thumbhash: null,
				author,
			}
			const file = toRef(row)
			const event = this.log.append(author, { t: "file", file })
			if (current) this.sql.exec("DELETE FROM ws_files WHERE id = ?", current.id)
			this.sql.exec(
				"INSERT INTO ws_files (id, path, r2_key, size, type, sha256, author, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
				row.id,
				row.path,
				row.r2_key,
				row.size,
				row.type,
				row.sha256,
				author,
				event.at,
			)
			return { file, drop: current?.r2_key ?? null, event }
		})
	}
}
