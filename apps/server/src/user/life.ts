import { capBytes, type Item, LIFE_SHAPE, region, LINE_BYTES, napPrompt, oneLine, type Span, Tree } from "../lib/optmem"

// Architecture section 13. The user's life log: what kiko knows about this human, across every chat.
// One line per memory, append-only, at most 280 bytes. Lines come from an agent's `note` and from
// rollups, where a chat's settled history becomes one line. A tree of summaries sits over it like a
// room's, and every agent reads the same view at the start of every run. The human can pin a line,
// so it heads the view, or redact one: its text is gone and the summaries above it are rebuilt.

/** The most lines a human may pin. */
export const MAX_PINS = 10

const TILING_KEY = "life_tiling"

export type LifeLine = { pos: number; at: number; text: string; source: string; tainted: boolean; pinned: boolean; redacted: boolean }

export type NoteResult = { ok: true; pos: number; duplicate?: true } | { ok: false; error: string }

type Row = { pos: number; at: number; text: string; source: string; tainted: number; pinned: number; redacted: number }

const norm = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()

export class Life {
  readonly tree: Tree

  constructor(
    private readonly sql: SqlStorage,
    private readonly transaction: <T>(fn: () => T) => T,
    private readonly settings: { get(key: string): string | null; set(key: string, value: string): void },
  ) {
    sql.exec(`CREATE TABLE IF NOT EXISTS life (
      pos INTEGER PRIMARY KEY,
      at INTEGER NOT NULL,
      text TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      norm TEXT NOT NULL,
      tainted INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      redacted INTEGER NOT NULL DEFAULT 0
    )`)
    sql.exec("CREATE INDEX IF NOT EXISTS life_norm ON life (norm)")
    sql.exec("CREATE VIRTUAL TABLE IF NOT EXISTS life_fts USING fts5(text)")
    this.tree = new Tree(sql, "life_tree", LIFE_SHAPE, (lo, hi) => this.items(lo, hi))
  }

  count(): number {
    const n = this.sql.exec<{ n: number | null }>("SELECT max(pos) AS n FROM life").one().n
    return n === null ? 0 : n + 1
  }

  /**
   * One line. `source` says where it came from: `@ada` for an agent's note, `chat trip` for a rollup.
   * A line the log already holds, word for word, is not stored twice.
   */
  append(text: string, source: string, tainted: boolean, at = Date.now()): NoteResult {
    const line = text.replace(/\s+/g, " ").trim()
    if (!line) return { ok: false, error: "empty. a memory is one line of text." }
    if (new TextEncoder().encode(line).byteLength > LINE_BYTES) return { ok: false, error: `too long: a memory is at most ${LINE_BYTES} bytes. say it shorter.` }
    const key = norm(line)
    return this.transaction(() => {
      const same = this.sql.exec<{ pos: number }>("SELECT pos FROM life WHERE norm = ? AND redacted = 0", key).toArray()[0]
      if (same) return { ok: true, pos: same.pos, duplicate: true } as const
      const pos = this.count()
      this.sql.exec("INSERT INTO life (pos, at, text, source, norm, tainted) VALUES (?, ?, ?, ?, ?, ?)", pos, at, line, source, key, tainted ? 1 : 0)
      this.sql.exec("INSERT INTO life_fts (rowid, text) VALUES (?, ?)", pos, line)
      return { ok: true, pos } as const
    })
  }

  items(lo: number, hi: number): Item[] {
    return this.sql
      .exec<Row>("SELECT pos, at, text, source, tainted, redacted FROM life WHERE pos >= ? AND pos < ? ORDER BY pos", lo, hi)
      .toArray()
      .map((r) => ({ pos: r.pos, at: r.at, text: r.redacted ? "(removed by the human)" : `${r.source ? `${r.source}: ` : ""}${r.text}`, tainted: r.tainted === 1 }))
  }

  /** The view every agent reads: pinned lines, then the log, older lines compressed. Empty for a new user. */
  view(now: number): string {
    const pins = this.sql.exec<Row>("SELECT pos, text FROM life WHERE pinned = 1 AND redacted = 0 ORDER BY pos").toArray()
    const prev = this.settings.get(TILING_KEY)
    const { lines, tiling } = this.tree.view(this.count(), prev ? (JSON.parse(prev) as Span[]) : null, now)
    if (JSON.stringify(tiling) !== prev) this.settings.set(TILING_KEY, JSON.stringify(tiling))
    return [...pins.map((p) => `pinned: ${p.text}`), ...lines].join("\n")
  }

  /** Lines that match, newest first. Word search, with a plain substring search when FTS finds nothing. */
  recall(query: string, limit = 10): LifeLine[] {
    const words = query.split(/\s+/).map((w) => w.replaceAll('"', "")).filter(Boolean).slice(0, 12)
    if (!words.length) return []
    const match = words.map((w) => `"${w}"*`).join(" OR ")
    let rows = this.sql
      .exec<Row>(
        "SELECT l.* FROM life_fts f JOIN life l ON l.pos = f.rowid WHERE life_fts MATCH ? AND l.redacted = 0 ORDER BY bm25(life_fts), l.pos DESC LIMIT ?",
        match,
        limit,
      )
      .toArray()
    // A part of a word FTS does not index ("4417" inside "4417b"): the longest word, escaped, as a substring.
    const longest = words.map((w) => w.replace(/[%_\\]/g, "")).sort((a, b) => b.length - a.length)[0]!.slice(0, 40)
    if (!rows.length && longest.length > 2) rows = this.sql.exec<Row>("SELECT * FROM life WHERE redacted = 0 AND text LIKE ? ORDER BY pos DESC LIMIT ?", `%${longest}%`, limit).toArray()
    return rows.map(toLine)
  }

  /** A line, or a node opened into its halves (`64-127`). */
  zoom(span: Span, now: number): string[] {
    return this.tree.zoom(span, this.count(), now)
  }

  /** The human's lines for the memory screen, newest first. */
  list(before: number | null, limit: number): LifeLine[] {
    return this.sql
      .exec<Row>("SELECT * FROM life WHERE pos < ? ORDER BY pos DESC LIMIT ?", before ?? Number.MAX_SAFE_INTEGER, Math.min(Math.max(limit, 1), 200))
      .toArray()
      .map(toLine)
  }

  /** Only the human. Pinned lines head every view. */
  pin(pos: number, pinned: boolean): { ok: true } | { ok: false; error: string } {
    const row = this.sql.exec<Row>("SELECT * FROM life WHERE pos = ?", pos).toArray()[0]
    if (!row || row.redacted) return { ok: false, error: "no such memory" }
    if (pinned && !row.pinned && this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM life WHERE pinned = 1").one().n >= MAX_PINS) {
      return { ok: false, error: `at most ${MAX_PINS} pinned memories. unpin one first.` }
    }
    this.sql.exec("UPDATE life SET pinned = ? WHERE pos = ?", pinned ? 1 : 0, pos)
    return { ok: true }
  }

  /** Only the human. The text is gone for good, and every summary built from it is made again. */
  redact(pos: number): boolean {
    return this.transaction(() => {
      const done = this.sql.exec("UPDATE life SET text = '', norm = '', redacted = 1, pinned = 0 WHERE pos = ? AND redacted = 0", pos).rowsWritten > 0
      if (!done) return false
      this.sql.exec("DELETE FROM life_fts WHERE rowid = ?", pos)
      this.tree.forget(pos)
      return true
    })
  }

  /** Summaries that are needed now: a page is summarized only once it leaves the verbatim floor. */
  pending(limit: number): Span[] {
    return this.tree.pending(region(this.count(), LIFE_SHAPE), limit)
  }

  /** The prompt for one summary, or null when its input went missing. */
  prompt(span: Span): string | null {
    const input = this.tree.input(span)
    return input ? napPrompt(input, "memories") : null
  }

  /** Stores a summary the model wrote for `span`, or the model-free one when `text` is null. */
  settle(span: Span, text: string | null): void {
    const input = this.tree.input(span)
    if (input) this.tree.put(span, this.tree.nodeFor(input, text ?? this.tree.fallback(input)))
  }

  /**
   * One-time import of the records store this log replaces: every dated bullet becomes a line, oldest
   * first, named by its record when that is not a profile, now, or todo. Returns the lines imported.
   */
  importRecords(): number {
    const has = this.sql.exec("SELECT 1 FROM sqlite_master WHERE name = 'memory_records'").toArray().length > 0
    if (!has) return 0
    const records = this.sql.exec<{ id: string; title: string; body: string; updated_at: number }>("SELECT id, title, body, updated_at FROM memory_records WHERE archived = 0").toArray()
    const lines: { at: number; text: string }[] = []
    for (const r of records) {
      for (const raw of r.body.split("\n")) {
        const line = raw.trim().replace(/^[-*]\s*/, "")
        if (!line) continue
        const dated = /^(\d{4}-\d{2}-\d{2}):\s*(.*?)(?:\s+\([^)]*\))?$/.exec(line)
        const at = dated ? Date.parse(`${dated[1]}T12:00:00Z`) : r.updated_at
        const text = dated ? dated[2]! : line
        const named = ["profile", "now", "todo"].includes(r.id) ? text : `${r.title}: ${text}`
        lines.push({ at: Number.isFinite(at) ? at : r.updated_at, text: capBytes(oneLine(named, 1_000), LINE_BYTES) })
      }
    }
    lines.sort((a, b) => a.at - b.at)
    let n = 0
    for (const l of lines) if (this.append(l.text, "", false, l.at).ok) n++
    for (const table of ["memory_records", "memory_versions", "memory_fts"]) this.sql.exec(`DROP TABLE IF EXISTS ${table}`)
    return n
  }
}

function toLine(r: Row): LifeLine {
  return { pos: r.pos, at: r.at, text: r.text, source: r.source, tainted: r.tainted === 1, pinned: r.pinned === 1, redacted: r.redacted === 1 }
}
