import type { MemoryOp, MemoryRecord, MemoryResult, MemoryType, MemoryVersion, Provenance } from "@kiko/protocol"

// Architecture section 13. The memory store inside `UserDO`. Records, their versions,
// and the FTS5 index change in one transaction, so a search never sees a half edit.
// An `append` adds one dated bullet and never rewrites. A `replace` is the only call
// that sets a whole body. Both store the old body in `memory_versions` first.

const SEEDS: { id: string; type: MemoryType; title: string }[] = [
  { id: "profile", type: "profile", title: "profile" },
  { id: "now", type: "now", title: "now" },
  { id: "todo", type: "todo", title: "todo" },
]

const SINGLETONS = new Set<string>(SEEDS.map((s) => s.id))
const MAX_BODY = 50_000
const MAX_LIMIT = 50
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/

type Row = {
  id: string
  type: string
  title: string
  aliases: string
  body: string
  pinned: number
  archived: number
  uses: number
  last_used_at: number
  created_at: number
  updated_at: number
  version: number
}

const COLUMNS = "id, type, title, aliases, body, pinned, archived, uses, last_used_at, created_at, updated_at, version"

export class MemoryError extends Error {}

function toRecord(row: Row): MemoryRecord {
  return {
    id: row.id,
    type: row.type as MemoryType,
    title: row.title,
    aliases: JSON.parse(row.aliases) as string[],
    body: row.body,
    pinned: row.pinned === 1,
    archived: row.archived === 1,
    uses: row.uses,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  }
}

/** Turns free text into an FTS5 query: every word is a quoted prefix, all must match. */
export function ftsQuery(text: string): string {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return words.map((w) => `"${w}"*`).join(" ")
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)

export type MemoryStore = ReturnType<typeof createMemory>

export function createMemory(sql: SqlStorage, tx: <T>(fn: () => T) => T, clock: () => number = Date.now) {
  let seeded = false

  const get = (id: string): Row | null =>
    sql.exec<Row>(`SELECT ${COLUMNS} FROM memory_records WHERE id = ?`, id).toArray()[0] ?? null

  const need = (id: string): Row => {
    const row = get(id)
    if (!row) throw new MemoryError(`no memory record ${id}`)
    return row
  }

  const reindex = (row: { id: string; title: string; aliases: string; body: string }) => {
    sql.exec("DELETE FROM memory_fts WHERE id = ?", row.id)
    sql.exec(
      "INSERT INTO memory_fts (id, title, aliases, body) VALUES (?, ?, ?, ?)",
      row.id,
      row.title,
      (JSON.parse(row.aliases) as string[]).join(" "),
      row.body,
    )
  }

  const insert = (id: string, type: MemoryType, title: string, aliases: readonly string[], body: string): Row => {
    const now = clock()
    const json = JSON.stringify(aliases.map((a) => a.trim()).filter(Boolean))
    sql.exec(
      `INSERT INTO memory_records (id, type, title, aliases, body, pinned, archived, uses, last_used_at, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, 1)`,
      id,
      type,
      title,
      json,
      body,
      now,
      now,
    )
    const row = need(id)
    reindex(row)
    return row
  }

  /** Stores the body being replaced, then sets the new one. */
  const setBody = (row: Row, body: string, author: string): Row => {
    if (body.length > MAX_BODY) throw new MemoryError("the record is too long")
    const now = clock()
    sql.exec(
      "INSERT INTO memory_versions (record_id, version, body, author, at) VALUES (?, ?, ?, ?, ?)",
      row.id,
      row.version,
      row.body,
      author,
      now,
    )
    sql.exec("UPDATE memory_records SET body = ?, version = version + 1, updated_at = ? WHERE id = ?", body, now, row.id)
    const next = need(row.id)
    reindex(next)
    return next
  }

  /** Seeds the three singletons on first use. Safe to run twice. */
  const seed = () => {
    if (seeded) return
    tx(() => {
      for (const s of SEEDS) if (!get(s.id)) insert(s.id, s.type, s.title, [], "")
    })
    seeded = true
  }

  const run = <T>(fn: () => T): T => {
    seed()
    return tx(fn)
  }

  const store = {
    create(input: { id?: string; type: MemoryType; title: string; aliases?: readonly string[]; body?: string; author: string }): MemoryRecord {
      return run(() => {
        const title = input.title.trim()
        if (!title) throw new MemoryError("a record needs a title")
        if (input.type === "profile" || input.type === "now" || input.type === "todo") {
          throw new MemoryError(`there is one ${input.type} record already`)
        }
        let id = input.id ?? (slug(title) || "record")
        if (!ID.test(id)) throw new MemoryError("an id is lowercase letters, digits, and dashes")
        if (input.id && get(id)) throw new MemoryError(`${id} exists`)
        for (let n = 2; get(id); n++) id = `${slug(title) || "record"}-${n}`
        if (SINGLETONS.has(id)) throw new MemoryError(`${id} is reserved`)
        const body = input.body ?? ""
        if (body.length > MAX_BODY) throw new MemoryError("the record is too long")
        return toRecord(insert(id, input.type, title, input.aliases ?? [], body))
      })
    },

    /** Every record, pinned first, then most recently changed. */
    list(includeArchived = false): MemoryRecord[] {
      return run(() =>
        sql
          .exec<Row>(
            `SELECT ${COLUMNS} FROM memory_records ${includeArchived ? "" : "WHERE archived = 0"} ORDER BY pinned DESC, updated_at DESC, id`,
          )
          .toArray()
          .map(toRecord),
      )
    },

    /** Matches titles, aliases, and bodies. Archived records are left out. Best match first. */
    search(query: string, limit = 10): MemoryRecord[] {
      const match = ftsQuery(query)
      if (!match) return []
      return run(() =>
        sql
          .exec<Row>(
            `SELECT ${COLUMNS.split(", ").map((c) => `r.${c}`).join(", ")}
             FROM memory_fts f JOIN memory_records r ON r.id = f.id
             WHERE memory_fts MATCH ? AND r.archived = 0
             ORDER BY bm25(memory_fts, 0, 4, 4, 1)
             LIMIT ?`,
            match,
            Math.max(1, Math.min(limit, MAX_LIMIT)),
          )
          .toArray()
          .map(toRecord),
      )
    },

    /** Returns one record and counts the use. Null when there is none. */
    view(id: string): MemoryRecord | null {
      return run(() => {
        if (!get(id)) return null
        sql.exec("UPDATE memory_records SET uses = uses + 1, last_used_at = ? WHERE id = ?", clock(), id)
        return toRecord(need(id))
      })
    },

    /** Reads without counting a use. The memory screen and the turn context use this. */
    peek(id: string): MemoryRecord | null {
      return run(() => {
        const row = get(id)
        return row ? toRecord(row) : null
      })
    },

    /** Old bodies, newest first. */
    history(id: string): MemoryVersion[] {
      return run(() =>
        sql
          .exec<{ record_id: string; version: number; body: string; author: string; at: number }>(
            "SELECT record_id, version, body, author, at FROM memory_versions WHERE record_id = ? ORDER BY version DESC",
            id,
          )
          .toArray()
          .map((v) => ({ recordId: v.record_id, version: v.version, body: v.body, author: v.author, at: v.at })),
      )
    },

    /** Adds one dated bullet. A missing record is created, titled by its id. */
    append(id: string, fact: string, provenance: Provenance): MemoryRecord {
      return run(() => {
        const text = fact.replace(/\s+/g, " ").trim()
        if (!text) throw new MemoryError("a fact cannot be empty")
        const date = new Date(clock()).toISOString().slice(0, 10)
        const who = provenance.tainted ? `${provenance.author}, tainted` : provenance.author
        const bullet = `- ${date}: ${text} (${who})`
        let row = get(id)
        if (!row) {
          if (!ID.test(id)) throw new MemoryError("an id is lowercase letters, digits, and dashes")
          row = insert(id, "conversation", id, [], "")
        }
        return toRecord(setBody(row, row.body ? `${row.body}\n${bullet}` : bullet, provenance.author))
      })
    },

    /** Sets the whole body. Always stores the old one in `memory_versions`. */
    replace(id: string, body: string, author: string): MemoryRecord {
      return run(() => toRecord(setBody(need(id), body, author)))
    },

    pin(id: string, pinned: boolean): MemoryRecord {
      return run(() => {
        need(id)
        sql.exec("UPDATE memory_records SET pinned = ?, updated_at = ? WHERE id = ?", pinned ? 1 : 0, clock(), id)
        return toRecord(need(id))
      })
    },

    /** An archived record leaves search and the default list. Its history stays. */
    archive(id: string, archived: boolean): MemoryRecord {
      return run(() => {
        if (archived && SINGLETONS.has(id)) throw new MemoryError(`${id} cannot be archived`)
        need(id)
        sql.exec("UPDATE memory_records SET archived = ?, updated_at = ? WHERE id = ?", archived ? 1 : 0, clock(), id)
        return toRecord(need(id))
      })
    },

    /** Deletes the record, its history, and its index row. Returns false when there was none. */
    remove(id: string): boolean {
      return run(() => {
        if (SINGLETONS.has(id)) throw new MemoryError(`${id} cannot be removed`)
        if (!get(id)) return false
        sql.exec("DELETE FROM memory_versions WHERE record_id = ?", id)
        sql.exec("DELETE FROM memory_fts WHERE id = ?", id)
        sql.exec("DELETE FROM memory_records WHERE id = ?", id)
        return true
      })
    },

    /** One socket request. Never throws: a failure becomes `{ ok: false }`. */
    handle(op: MemoryOp): MemoryResult {
      try {
        switch (op.op) {
          case "list":
            return { ok: true, records: store.list(op.includeArchived) }
          case "search":
            return { ok: true, records: store.search(op.query, op.limit) }
          case "view":
            return { ok: true, record: store.view(op.id) }
          case "history":
            return { ok: true, versions: store.history(op.id) }
          case "create":
            return { ok: true, record: store.create(op) }
          case "append":
            return { ok: true, record: store.append(op.id, op.fact, op.provenance) }
          case "replace":
            return { ok: true, record: store.replace(op.id, op.body, op.author) }
          case "pin":
            return { ok: true, record: store.pin(op.id, op.pinned) }
          case "archive":
            return { ok: true, record: store.archive(op.id, op.archived) }
          case "remove":
            return { ok: true, removed: store.remove(op.id) }
        }
      } catch (e) {
        if (e instanceof MemoryError) return { ok: false, error: e.message }
        throw e
      }
    },
  }
  return store
}
