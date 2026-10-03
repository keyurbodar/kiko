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
	at?: number
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
	/** What the client measured at upload time. The attachment job computes only what is missing. */
	width?: number
	height?: number
	thumbhash?: string
	/**
	 * A precondition for an edit. A SHA-256 means the path must hold exactly those bytes,
	 * and "none" means the path must be empty. Anything else is a conflict and nothing is written.
	 */
	expectSha256?: string
}

/** What the attachment job needs to know about a file. */
export type FileMeta = { r2Key: string; size: number; type: string; width?: number; height?: number; thumbhash?: string }

export type FileMetaPatch = { width?: number; height?: number; thumbhash?: string }

/** One entry of the room's file space. Folders are path prefixes: one exists while it holds a file. */
export type FsEntry =
	| { kind: "file"; path: string; id: string; size: number; type: string; sha256: string; r2Key: string; at: number }
	| { kind: "directory"; path: string; files: number; size: number }

/** Why an operation changed nothing. The codes are `pi-durable`'s `FileErrorCode`s. */
export type FsFail = { ok: false; code: "not_found" | "is_directory" | "not_directory" | "invalid"; message: string }

export type FsChange = { ok: true; events: RoomEvent[]; drop: string[]; changed: number }

const fail = (code: FsFail["code"], message: string): FsFail => ({ ok: false, code, message })

/** The name after the last slash. */
export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1)

/**
 * Bounds of every path under `dir` (empty for the root), for a scan on the unique index. "/" is
 * 0x2f and "0" is 0x30, so `dir0` sorts after every `dir/...` whatever bytes follow.
 */
function under(dir: string): [string, string | null] {
	return dir ? [`${dir}/`, `${dir}0`] : ["", null]
}

export type PutResult = {
	/** Null only for a conflict on a path that holds no file. */
	file: FileRef | null
	/** An R2 key nothing points to any more. The caller deletes it. */
	drop: string | null
	event: RoomEvent | null
	/** True when `expectSha256` did not match. `file` is then what the path holds now, and nothing was written. */
	conflict?: boolean
	/** The path is a folder, or a parent of it is a file. Nothing was written. */
	refused?: FsFail
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
			if (input.expectSha256 !== undefined && (current?.sha256 ?? "none") !== input.expectSha256) {
				return { file: current ? toRef(current) : null, drop: input.r2Key, event: null, conflict: true }
			}
			if (!current) {
				const clash = this.clash(input.path)
				if (clash) return { file: null, drop: input.r2Key, event: null, refused: clash }
			}
			if (current?.sha256 === input.sha256) return { file: toRef(current), drop: input.r2Key, event: null }
			const author = actorKey(input.author)
			const row: FileRow = {
				id: input.id,
				path: input.path,
				r2_key: input.r2Key,
				size: input.size,
				type: input.type,
				sha256: input.sha256,
				width: input.width ?? null,
				height: input.height ?? null,
				thumbhash: input.thumbhash ?? null,
				author,
			}
			const file = toRef(row)
			const event = this.log.append(author, { t: "file", file })
			if (current) this.sql.exec("DELETE FROM ws_files WHERE id = ?", current.id)
			this.sql.exec(
				"INSERT INTO ws_files (id, path, r2_key, size, type, sha256, width, height, thumbhash, author, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
				row.id,
				row.path,
				row.r2_key,
				row.size,
				row.type,
				row.sha256,
				row.width,
				row.height,
				row.thumbhash,
				author,
				event.at,
			)
			return { file, drop: current?.r2_key ?? null, event }
		})
	}

	/** Why a new file cannot go at `path`: a folder is there, or one of its parents is a file. */
	private clash(path: string): FsFail | null {
		if (this.files(path, 1).length) return fail("is_directory", `${path} is a folder`)
		for (let i = path.indexOf("/"); i !== -1; i = path.indexOf("/", i + 1)) {
			const parent = path.slice(0, i)
			if (this.row("path", parent)) return fail("not_directory", `${parent} is a file, not a folder`)
		}
		return null
	}

	/** The rows under `dir`, by path. */
	private files(dir: string, limit = -1): FileRow[] {
		const [lo, hi] = under(dir)
		return hi === null
			? this.sql.exec<FileRow>("SELECT * FROM ws_files WHERE path >= ? ORDER BY path LIMIT ?", lo, limit).toArray()
			: this.sql.exec<FileRow>("SELECT * FROM ws_files WHERE path >= ? AND path < ? ORDER BY path LIMIT ?", lo, hi, limit).toArray()
	}

	private entry(r: FileRow & { at?: number }): FsEntry {
		return { kind: "file", path: r.path, id: r.id, size: r.size, type: r.type, sha256: r.sha256, r2Key: r.r2_key, at: r.at ?? 0 }
	}

	/** A file, a folder, or null. The empty path is the root, which always exists. */
	stat(path: string): FsEntry | null {
		const file = this.row("path", path)
		if (file) return this.entry(file)
		if (path === "") return { kind: "directory", path, ...this.tally("") }
		const tally = this.tally(path)
		return tally.files ? { kind: "directory", path, ...tally } : null
	}

	private tally(dir: string): { files: number; size: number } {
		const [lo, hi] = under(dir)
		const row =
			hi === null
				? this.sql.exec<{ n: number; size: number | null }>("SELECT count(*) AS n, sum(size) AS size FROM ws_files WHERE path >= ?", lo).one()
				: this.sql.exec<{ n: number; size: number | null }>("SELECT count(*) AS n, sum(size) AS size FROM ws_files WHERE path >= ? AND path < ?", lo, hi).one()
		return { files: row.n, size: row.size ?? 0 }
	}

	/** What `dir` holds: its files, and a folder for each first segment below it. All of it with `recursive`. */
	list(dir: string, recursive = false): FsEntry[] | FsFail {
		const self = this.stat(dir)
		if (!self) return fail("not_found", `no such folder: ${dir}`)
		if (self.kind === "file") return [self]
		const prefix = dir ? `${dir}/` : ""
		const out: FsEntry[] = []
		const folders = new Map<string, { files: number; size: number }>()
		for (const r of this.files(dir)) {
			const rest = r.path.slice(prefix.length)
			const slash = rest.indexOf("/")
			if (recursive || slash === -1) out.push(this.entry(r))
			if (slash !== -1) {
				const name = prefix + rest.slice(0, slash)
				const t = folders.get(name) ?? { files: 0, size: 0 }
				t.files++
				t.size += r.size
				folders.set(name, t)
			}
		}
		const dirs: FsEntry[] = [...folders].map(([path, t]) => ({ kind: "directory", path, ...t }))
		return recursive ? out : [...dirs, ...out]
	}

	/**
	 * `mv from to`, as on Linux. Into an existing folder, the name is kept. A file onto a file replaces
	 * it. A folder moves with everything in it, and never onto a file or a folder that exists. Only
	 * paths change: ids and R2 objects stay, so a move costs one row update per file.
	 */
	move(from: string, to: string, by: Actor): FsChange | FsFail {
		return this.storage.transactionSync(() => {
			const src = this.stat(from)
			if (!src || from === "") return fail("not_found", `no such file or folder: ${from || "/"}`)
			const dest = this.stat(to)
			const target = dest?.kind === "directory" ? (to ? `${to}/${baseName(from)}` : baseName(from)) : to
			if (target === from) return { ok: true, events: [], drop: [], changed: 0 }
			if (target === "" || `${target}/`.startsWith(`${from}/`)) return fail("invalid", `cannot move ${from} into itself`)
			const author = actorKey(by)
			const events: RoomEvent[] = []
			const drop: string[] = []
			const there = this.stat(target)
			if (src.kind === "file") {
				if (there?.kind === "directory") return fail("is_directory", `${target} is a folder`)
				if (!there) {
					const clash = this.clash(target)
					if (clash) return clash
				}
				if (there?.kind === "file") {
					this.sql.exec("DELETE FROM ws_files WHERE id = ?", there.id)
					drop.push(there.r2Key)
					events.push(this.log.append(author, { t: "file_removed", ids: [there.id] }))
				}
				events.push(this.rename(this.row("id", src.id)!, target, author))
				return { ok: true, events, drop, changed: 1 }
			}
			if (there) return fail(there.kind === "file" ? "not_directory" : "is_directory", `${target} already exists`)
			const clash = this.clash(target)
			if (clash) return clash
			const rows = this.files(from)
			for (const r of rows) events.push(this.rename(r, target + r.path.slice(from.length), author))
			return { ok: true, events, drop, changed: rows.length }
		})
	}

	private rename(r: FileRow, path: string, author: string): RoomEvent {
		this.sql.exec("UPDATE ws_files SET path = ? WHERE id = ?", path, r.id)
		return this.log.append(author, { t: "file", file: toRef({ ...r, path }) })
	}

	/**
	 * `rm`, as on Linux: a folder needs `recursive`. Every path is checked first, so a refusal
	 * deletes nothing. One `file_removed` event covers the lot.
	 */
	remove(paths: readonly string[], recursive: boolean, by: Actor): FsChange | FsFail {
		return this.storage.transactionSync(() => {
			const rows = new Map<string, FileRow>()
			for (const path of paths) {
				const entry = this.stat(path)
				if (!entry || path === "") return fail("not_found", `no such file or folder: ${path || "/"}`)
				if (entry.kind === "directory" && !recursive) return fail("is_directory", `${path} is a folder. remove it with recursive`)
				for (const r of entry.kind === "file" ? [this.row("id", entry.id)!] : this.files(path)) rows.set(r.id, r)
			}
			if (!rows.size) return { ok: true, events: [], drop: [], changed: 0 }
			for (const id of rows.keys()) this.sql.exec("DELETE FROM ws_files WHERE id = ?", id)
			const event = this.log.append(actorKey(by), { t: "file_removed", ids: [...rows.keys()] })
			return { ok: true, events: [event], drop: [...rows.values()].map((r) => r.r2_key), changed: rows.size }
		})
	}

	/** The files at `paths`, a folder giving everything in it. At most `max`, so one message stays small. */
	refs(paths: readonly string[], max: number): FileRef[] | FsFail {
		const out = new Map<string, FileRow>()
		for (const path of paths) {
			const entry = this.stat(path)
			if (!entry) return fail("not_found", `no such file or folder: /${path}`)
			for (const r of entry.kind === "file" ? [this.row("id", entry.id)!] : this.files(path)) out.set(r.id, r)
		}
		if (out.size > max) return fail("invalid", `that is ${out.size} files; a message carries at most ${max}. send a folder's path in the text instead`)
		return [...out.values()].map(toRef)
	}

	/** What the attachment job reads. Null when the file is gone. */
	meta(id: string): FileMeta | null {
		const r = this.row("id", id)
		if (!r) return null
		return {
			r2Key: r.r2_key,
			size: r.size,
			type: r.type,
			...(r.width !== null ? { width: r.width } : {}),
			...(r.height !== null ? { height: r.height } : {}),
			...(r.thumbhash !== null ? { thumbhash: r.thumbhash } : {}),
		}
	}

	/**
	 * Fills empty metadata fields and nothing else, so a repeated call changes nothing and
	 * stores no event. Returns the event to publish when something changed.
	 */
	fillMeta(id: string, patch: FileMetaPatch): RoomEvent | null {
		return this.storage.transactionSync(() => {
			const r = this.row("id", id)
			if (!r) return null
			const next = {
				width: r.width ?? patch.width ?? null,
				height: r.height ?? patch.height ?? null,
				thumbhash: r.thumbhash ?? patch.thumbhash ?? null,
			}
			if (next.width === r.width && next.height === r.height && next.thumbhash === r.thumbhash) return null
			this.sql.exec(
				"UPDATE ws_files SET width = ?, height = ?, thumbhash = ? WHERE id = ?",
				next.width,
				next.height,
				next.thumbhash,
				id,
			)
			return this.log.append(r.author, { t: "file", file: toRef({ ...r, ...next }) })
		})
	}
}
