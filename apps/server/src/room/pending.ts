import * as Schema from "effect/Schema"
import {
  attachmentMessages,
  attachmentsError,
  type FileRef,
  type PendingAttachment,
  type RoomEvent,
} from "@kiko/protocol"
import { cleanPath, isControl } from "../files/paths"
import type { FileIndex } from "../files/file-index"
import type { FileBucket } from "../files/store"

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

export class ClaimRefused extends Schema.TaggedError<ClaimRefused>()("ClaimRefused", {
  message: Schema.String,
}) {}

export class PendingUploads {
  constructor(
    private readonly sql: SqlStorage,
    private readonly roomId: string,
  ) {}

  open(input: NewPending, now: number): string | null {
    if (
      this.sql.exec("SELECT 1 FROM files WHERE id = ?1 AND files.room_id = ?2", input.id, this.roomId).toArray().length
    )
      return "that id is taken"
    const row = this.get(input.id)
    if (row) {
      if (row.size !== input.size || row.r2_key !== input.r2Key) return "that id is taken"
      this.sql.exec(
        "UPDATE pending_uploads SET upload_id = ?1, sha256 = NULL WHERE id = ?2 AND pending_uploads.room_id = ?3",
        input.uploadId ?? null,
        input.id,
        this.roomId,
      )
      return null
    }
    this.sql.exec(
      "INSERT INTO pending_uploads (id, name, type, size, r2_key, upload_id, created_at, room_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
      input.id,
      input.name,
      input.type,
      input.size,
      input.r2Key,
      input.uploadId ?? null,
      now,
      this.roomId,
    )
    return null
  }

  get(id: string): PendingRow | null {
    return (
      this.sql
        .exec<PendingRow>(
          "SELECT * FROM pending_uploads WHERE id = ?1 AND pending_uploads.room_id = ?2",
          id,
          this.roomId,
        )
        .toArray()[0] ?? null
    )
  }

  ready(id: string, sha256: string, size: number): "ok" | "gone" | "size" {
    const row = this.get(id)
    if (!row) return "gone"
    if (row.size !== size) return "size"
    this.sql.exec(
      "UPDATE pending_uploads SET sha256 = ?1, upload_id = NULL WHERE id = ?2 AND pending_uploads.room_id = ?3",
      sha256,
      id,
      this.roomId,
    )
    return "ok"
  }

  remove(id: string): PendingRow | null {
    const row = this.get(id)
    if (row)
      this.sql.exec("DELETE FROM pending_uploads WHERE id = ?1 AND pending_uploads.room_id = ?2", id, this.roomId)
    return row
  }

  claimExpired(before: number, limit = 500): PendingRow[] {
    return this.sql
      .exec<PendingRow>(
        "DELETE FROM pending_uploads WHERE pending_uploads.room_id = ?3 AND id IN (SELECT id FROM pending_uploads WHERE created_at < ?1 AND pending_uploads.room_id = ?3 ORDER BY created_at LIMIT ?2) RETURNING *",
        before,
        limit,
        this.roomId,
      )
      .toArray()
  }

  drop(ids: readonly string[]): void {
    if (ids.length)
      this.sql.exec(
        "DELETE FROM pending_uploads WHERE id IN (SELECT value FROM JSON_EACH(?1)) AND pending_uploads.room_id = ?2",
        JSON.stringify(ids),
        this.roomId,
      )
  }

  nextExpiry(): number | null {
    const at = this.sql
      .exec<{ at: number | null }>(
        "SELECT MIN(created_at) AS at FROM pending_uploads WHERE pending_uploads.room_id = ?1",
        this.roomId,
      )
      .one().at
    return at === null ? null : at + PENDING_TTL_MS
  }

  keys(): string[] {
    return this.sql
      .exec<{ r2_key: string }>("SELECT r2_key FROM pending_uploads WHERE pending_uploads.room_id = ?1", this.roomId)
      .toArray()
      .map((r) => r.r2_key)
  }

  count(): number {
    return this.sql
      .exec<{ n: number }>("SELECT COUNT(*) AS n FROM pending_uploads WHERE pending_uploads.room_id = ?1", this.roomId)
      .one().n
  }

  age(ms: number): void {
    this.sql.exec(
      "UPDATE pending_uploads SET created_at = created_at - ?1 WHERE pending_uploads.room_id = ?2",
      ms,
      this.roomId,
    )
  }
}

export function liveUploadIds(sql: SqlStorage): string[] {
  return sql
    .exec<{ upload_id: string }>("SELECT upload_id FROM pending_uploads WHERE upload_id IS NOT NULL")
    .toArray()
    .map((row) => row.upload_id)
}

export async function openPending(
  pending: PendingUploads,
  files: FileBucket,
  input: NewPending,
  now: number,
): Promise<string | null> {
  const before = pending.get(input.id)
  const refused = pending.open(input, now)
  if (refused) return refused
  if (before?.upload_id && before.upload_id !== (input.uploadId ?? null))
    await files
      .resumeMultipartUpload(before.r2_key, before.upload_id)
      .abort()
      .catch(() => {})
  return null
}

function safeName(name: string): string {
  const parts = name
    .replaceAll("\\", "/")
    .split("/")
    .map((part) =>
      part
        .split("")
        .map((c) => (isControl(c) ? "_" : c))
        .join("")
        .trim(),
    )
    .filter((part) => part !== "" && part !== "." && part !== "..")
  return parts.join("/").slice(-120).replace(/^\/+/, "") || "file"
}

export function attachmentPath(name: string, now: number, taken: (path: string) => boolean): string {
  for (let t = now; ; t++) {
    const path = `attachments/${t.toString(36)}-${safeName(name)}`
    if (cleanPath(path) && !taken(path)) return path
  }
}

export function claim(
  pending: PendingUploads,
  files: FileIndex<RoomEvent>,
  list: readonly PendingAttachment[],
  now: number,
): { refs: FileRef[]; events: RoomEvent[] } {
  const limit = attachmentsError(list)
  if (limit) throw new ClaimRefused({ message: limit })
  if (new Set(list.map((a) => a.pendingId)).size !== list.length)
    throw new ClaimRefused({ message: "Duplicate attachment ids are not allowed." })
  const refs: FileRef[] = []
  const events: RoomEvent[] = []
  const used = new Set<string>()
  for (const a of list) {
    const row = pending.get(a.pendingId)
    const refuse = (why: string) => new ClaimRefused({ message: attachmentMessages.notSendable(a.name, why) })
    if (!row || row.sha256 === null) throw refuse("attachment not found (removed or expired)")
    if (row.size !== a.size) throw refuse("stored size does not match")
    if (row.type !== a.type) throw refuse("attachment type does not match the upload")
    const path = attachmentPath(row.name, now, (p) => used.has(p) || files.stat(p) !== null)
    used.add(path)
    const out = files.put({
      id: row.id,
      path,
      r2Key: row.r2_key,
      size: row.size,
      type: row.type,
      sha256: row.sha256,
      author: { kind: "human" },
      expectSha256: "none",
    })
    if (!out.file || out.refused || out.drop) throw refuse(out.refused?.message ?? "the chat's files refused it")
    refs.push(out.file)
    events.push(...out.events)
  }
  pending.drop(list.map((a) => a.pendingId))
  return { refs, events }
}
