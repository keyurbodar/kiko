import { type Step } from "@kiko/durable/migrate"
import {
  CHUNK_BYTES,
  FILE_TOO_LARGE,
  MAX_SPACE_BYTES,
  MAX_STORE_FILE_BYTES,
  STORAGE_FULL,
  type StoredInfo,
} from "./file-limits"

export const FILE_STEPS: Step[] = [
  `
	CREATE TABLE IF NOT EXISTS obj (
		key TEXT PRIMARY KEY,
		size INTEGER NOT NULL,
		type TEXT NOT NULL,
		meta TEXT NOT NULL,
		etag TEXT NOT NULL
	) WITHOUT ROWID;
	-- pos and len place a chunk in its file. A file joined from parts has short chunks in the middle.
	CREATE TABLE IF NOT EXISTS chunk (
		key TEXT NOT NULL,
		idx INTEGER NOT NULL,
		pos INTEGER NOT NULL,
		len INTEGER NOT NULL,
		data BLOB NOT NULL,
		PRIMARY KEY (key, idx)
	) WITHOUT ROWID;
	CREATE TABLE IF NOT EXISTS upload (
		id TEXT PRIMARY KEY,
		key TEXT NOT NULL,
		type TEXT NOT NULL,
		meta TEXT NOT NULL
	) WITHOUT ROWID;
	`,
]

const partKey = (uploadId: string, n: number) => `part:${uploadId}:${n}`

export class BlobStore {
  constructor(private readonly ctx: DurableObjectState) {}

  #used(key: string): number {
    const sql = this.ctx.storage.sql
    const uploadId = /^part:([^:]+):/.exec(key)?.[1]
    const target = uploadId ? sql.exec<{ key: string }>("SELECT key FROM upload WHERE id = ?", uploadId).one().key : key
    const prefix = target.slice(0, target.lastIndexOf("/") + 1)
    return sql
      .exec<{ n: number }>(
        "SELECT COALESCE(SUM(size), 0) AS n FROM obj o WHERE substr(o.key, 1, length(?)) = ? OR EXISTS (SELECT 1 FROM upload u WHERE substr(u.key, 1, length(?)) = ? AND substr(o.key, 1, length('part:' || u.id || ':')) = 'part:' || u.id || ':')",
        prefix,
        prefix,
        prefix,
        prefix,
      )
      .one().n
  }

  #drop(keys: readonly string[]): void {
    const sql = this.ctx.storage.sql
    const list = JSON.stringify(keys)
    sql.exec("DELETE FROM chunk WHERE key IN (SELECT value FROM json_each(?))", list)
    sql.exec("DELETE FROM obj WHERE key IN (SELECT value FROM json_each(?))", list)
  }

  async #write(
    key: string,
    body: ReadableStream<Uint8Array> | Uint8Array,
    type: string,
    meta: Record<string, string>,
  ): Promise<StoredInfo> {
    const sql = this.ctx.storage.sql
    this.#drop([key])
    const room = MAX_SPACE_BYTES - this.#used(key)
    let size = 0
    let idx = 0
    let written = 0
    let pending: Uint8Array[] = []
    let pendingBytes = 0
    const flush = (all: boolean) => {
      const joined = new Uint8Array(pendingBytes)
      let at = 0
      for (const part of pending) {
        joined.set(part, at)
        at += part.length
      }
      let offset = 0
      const limit = all ? joined.length : joined.length - (joined.length % CHUNK_BYTES)
      while (offset < limit) {
        const piece = joined.slice(offset, offset + CHUNK_BYTES)
        sql.exec(
          "INSERT INTO chunk (key, idx, pos, len, data) VALUES (?, ?, ?, ?, ?)",
          key,
          idx++,
          written,
          piece.length,
          piece,
        )
        written += piece.length
        offset += piece.length
      }
      pending = offset < joined.length ? [joined.slice(offset)] : []
      pendingBytes = joined.length - offset
    }
    try {
      const take = (bytes: Uint8Array) => {
        size += bytes.length
        if (size > MAX_STORE_FILE_BYTES) throw new Error(FILE_TOO_LARGE)
        if (size > room) throw new Error(STORAGE_FULL)
        pending.push(bytes)
        pendingBytes += bytes.length
        if (pendingBytes >= CHUNK_BYTES) flush(false)
      }
      if (body instanceof Uint8Array) take(body)
      else {
        const reader = body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          take(value)
        }
      }
      flush(true)
    } catch (e) {
      this.#drop([key])
      throw e
    }
    const info = { size, type, meta, etag: `"${crypto.randomUUID()}"` }
    sql.exec(
      "INSERT INTO obj (key, size, type, meta, etag) VALUES (?, ?, ?, ?, ?)",
      key,
      size,
      type,
      JSON.stringify(meta),
      info.etag,
    )
    return info
  }

  put(
    key: string,
    body: ReadableStream<Uint8Array> | Uint8Array,
    type: string,
    meta: Record<string, string>,
  ): Promise<StoredInfo> {
    return this.#write(key, body, type, meta)
  }

  #info(key: string): StoredInfo | null {
    const row = this.ctx.storage.sql
      .exec<{ size: number; type: string; meta: string; etag: string }>(
        "SELECT size, type, meta, etag FROM obj WHERE key = ?",
        key,
      )
      .toArray()[0]
    return row
      ? { size: row.size, type: row.type, meta: JSON.parse(row.meta) as Record<string, string>, etag: row.etag }
      : null
  }

  head(key: string): StoredInfo | null {
    return this.#info(key)
  }

  get(key: string, offset = 0, length?: number): { info: StoredInfo; body: ReadableStream<Uint8Array> } | null {
    const info = this.#info(key)
    if (!info) return null
    const sql = this.ctx.storage.sql
    const start = Math.min(offset, info.size)
    const end = length === undefined ? info.size : Math.min(info.size, start + length)
    let next = 0
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        const row = sql
          .exec<{ idx: number; pos: number; data: ArrayBuffer }>(
            "SELECT idx, pos, data FROM chunk WHERE key = ? AND idx >= ? AND pos + len > ? AND pos < ? ORDER BY idx LIMIT 1",
            key,
            next,
            start,
            end,
          )
          .toArray()[0]
        if (!row) return controller.close()
        next = row.idx + 1
        const from = Math.max(0, start - row.pos)
        controller.enqueue(new Uint8Array(row.data, from, Math.min(row.data.byteLength, end - row.pos) - from))
      },
    })
    return { info, body }
  }

  remove(keys: string[]): void {
    this.#drop(keys)
  }

  startUpload(key: string, type: string, meta: Record<string, string>): string {
    const id = crypto.randomUUID()
    this.ctx.storage.sql.exec(
      "INSERT INTO upload (id, key, type, meta) VALUES (?, ?, ?, ?)",
      id,
      key,
      type,
      JSON.stringify(meta),
    )
    return id
  }

  async putPart(
    uploadId: string,
    n: number,
    body: ReadableStream<Uint8Array>,
  ): Promise<{ partNumber: number; etag: string }> {
    const known = this.ctx.storage.sql.exec("SELECT 1 FROM upload WHERE id = ?", uploadId).toArray().length > 0
    if (!known) throw new Error("no such upload")
    const info = await this.#write(partKey(uploadId, n), body, "application/octet-stream", {})
    return { partNumber: n, etag: info.etag }
  }

  finish(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): StoredInfo {
    const sql = this.ctx.storage.sql
    return this.ctx.storage.transactionSync(() => {
      const upload = sql
        .exec<{ type: string; meta: string }>("SELECT type, meta FROM upload WHERE id = ? AND key = ?", uploadId, key)
        .toArray()[0]
      if (!upload) throw new Error("no such upload")
      this.#drop([key])
      let size = 0
      let chunks = 0
      for (const part of parts) {
        const from = partKey(uploadId, part.partNumber)
        const info = this.#info(from)
        if (!info || info.etag !== part.etag) throw new Error("a part is missing")
        sql.exec("UPDATE chunk SET key = ?, idx = idx + ?, pos = pos + ? WHERE key = ?", key, chunks, size, from)
        chunks = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM chunk WHERE key = ?", key).one().n
        size += info.size
        sql.exec("DELETE FROM obj WHERE key = ?", from)
      }
      const info = {
        size,
        type: upload.type,
        meta: JSON.parse(upload.meta) as Record<string, string>,
        etag: `"${crypto.randomUUID()}"`,
      }
      sql.exec(
        "INSERT INTO obj (key, size, type, meta, etag) VALUES (?, ?, ?, ?, ?)",
        key,
        size,
        info.type,
        upload.meta,
        info.etag,
      )
      sql.exec("DELETE FROM upload WHERE id = ?", uploadId)
      return info
    })
  }

  abort(uploadId: string): void {
    const sql = this.ctx.storage.sql
    const parts = sql
      .exec<{ key: string }>("SELECT key FROM obj WHERE key LIKE ?", `${partKey(uploadId, 0).slice(0, -1)}%`)
      .toArray()
    this.#drop(parts.map((p) => p.key))
    sql.exec("DELETE FROM upload WHERE id = ?", uploadId)
  }
}
