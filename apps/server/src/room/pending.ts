import { attachmentMessages, attachmentsError, type FileRef, type PendingAttachment, type RoomEvent } from "@kiko/protocol"
import { cleanPath, isControl } from "../files/upload"
import type { FileIndex } from "../files/file-index"


export const PENDING_TTL_MS = 24 * 3_600_000
export const PENDING_WAKEUP = "pending_sweep"

export type PendingRow = {
	id: string
	name: string
	type: string
	size: number
	r2_key: string
	sha256: string | null
	upload_id: string | null
	created_at: number
}

export type NewPending = { id: string; name: string; type: string; size: number; r2Key: string; uploadId?: string }

export class ClaimRefused extends Error {}

export class PendingUploads {
	constructor(private readonly sql: SqlStorage) {}

	open(input: NewPending, now: number): string | null {
		if (this.sql.exec("SELECT 1 FROM ws_files WHERE id = ?", input.id).toArray().length) return "that id is taken"
		const row = this.get(input.id)
		if (row) {
			if (row.size !== input.size || row.r2_key !== input.r2Key) return "that id is taken"
			this.sql.exec("UPDATE pending_uploads SET upload_id = ?, sha256 = NULL WHERE id = ?", input.uploadId ?? null, input.id)
			return null
		}
		this.sql.exec(
			"INSERT INTO pending_uploads (id, name, type, size, r2_key, upload_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			input.id,
			input.name,
			input.type,
			input.size,
			input.r2Key,
			input.uploadId ?? null,
			now,
		)
		return null
	}

	get(id: string): PendingRow | null {
		return this.sql.exec<PendingRow>("SELECT * FROM pending_uploads WHERE id = ?", id).toArray()[0] ?? null
	}

	ready(id: string, sha256: string, size: number): "ok" | "gone" | "size" {
		const row = this.get(id)
		if (!row) return "gone"
		if (row.size !== size) return "size"
		this.sql.exec("UPDATE pending_uploads SET sha256 = ?, upload_id = NULL WHERE id = ?", sha256, id)
		return "ok"
	}

	remove(id: string): PendingRow | null {
		const row = this.get(id)
		if (row) this.sql.exec("DELETE FROM pending_uploads WHERE id = ?", id)
		return row
	}

	expired(before: number, limit = 500): PendingRow[] {
		return this.sql.exec<PendingRow>("SELECT * FROM pending_uploads WHERE created_at < ? ORDER BY created_at LIMIT ?", before, limit).toArray()
	}

	drop(ids: readonly string[]): void {
		if (ids.length) this.sql.exec("DELETE FROM pending_uploads WHERE id IN (SELECT value FROM json_each(?))", JSON.stringify(ids))
	}

	nextExpiry(): number | null {
		const at = this.sql.exec<{ at: number | null }>("SELECT min(created_at) AS at FROM pending_uploads").one().at
		return at === null ? null : at + PENDING_TTL_MS
	}

	keys(): string[] {
		return this.sql.exec<{ r2_key: string }>("SELECT r2_key FROM pending_uploads").toArray().map((r) => r.r2_key)
	}

	count(): number {
		return this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM pending_uploads").one().n
	}

	age(ms: number): void {
		this.sql.exec("UPDATE pending_uploads SET created_at = created_at - ?", ms)
	}
}

export function safeName(name: string): string {
	return name.split("").map((c) => (c === "/" || c === "\\" || isControl(c) ? "_" : c)).join("").slice(-120) || "file"
}

/**
 * `attachments/<time>-<name>`, at a path nothing holds yet. Two files of one message with the
 * same name, or a send in the same millisecond, take the next free time. The client reads the
 * name back with `fileName`.
 */
export function attachmentPath(name: string, now: number, taken: (path: string) => boolean): string {
	for (let t = now; ; t++) {
		const path = `attachments/${t.toString(36)}-${safeName(name)}`
		if (cleanPath(path) && !taken(path)) return path
	}
}

/**
 * Moves a send's pending uploads into the chat's files, in order, and returns what the message
 * carries and the events to publish. Throws `ClaimRefused` with the reason the composer shows; the
 * caller runs this inside the send's transaction, so a refusal leaves no row changed. The object
 * stays at its key: a claimed file is indexed where its bytes already are.
 */
export function claim(
	pending: PendingUploads,
	files: FileIndex<RoomEvent>,
	list: readonly PendingAttachment[],
	now: number,
): { refs: FileRef[]; events: RoomEvent[] } {
	const limit = attachmentsError(list)
	if (limit) throw new ClaimRefused(limit)
	if (new Set(list.map((a) => a.pendingId)).size !== list.length) throw new ClaimRefused("Duplicate attachment ids are not allowed.")
	const refs: FileRef[] = []
	const events: RoomEvent[] = []
	const used = new Set<string>()
	for (const a of list) {
		const row = pending.get(a.pendingId)
		const refuse = (why: string) => new ClaimRefused(attachmentMessages.notSendable(a.name, why))
		if (!row || row.sha256 === null) throw refuse("attachment not found (removed or expired)")
		if (row.size !== a.size) throw refuse("stored size does not match")
		if (row.type !== a.type) throw refuse("attachment type does not match the upload")
		const path = attachmentPath(row.name, now, (p) => used.has(p) || files.stat(p) !== null)
		used.add(path)
		const out = files.put({ id: row.id, path, r2Key: row.r2_key, size: row.size, type: row.type, sha256: row.sha256, author: { kind: "human" }, expectSha256: "none" })
		if (!out.file || out.refused || out.drop) throw refuse(out.refused?.message ?? "the chat's files refused it")
		refs.push(out.file)
		events.push(...out.events)
	}
	pending.drop(list.map((a) => a.pendingId))
	return { refs, events }
}
