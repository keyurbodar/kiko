import { type Item, LIFE_SHAPE, LINE_BYTES, napPrompt, region, type Span, type Step, Tree, treeSteps } from "./optmem"

export const MAX_PINS = 10
export const CARD_MAX = 12
export const CARD_TAGS = ["IDENTITY", "ATTRIBUTE", "RELATIONSHIP", "INSTRUCTION"] as const
export type CardTag = (typeof CARD_TAGS)[number]
export const isCardTag = (value: unknown): value is CardTag => CARD_TAGS.includes(value as CardTag)

const TILING_KEY = "life_tiling"

export type LifeLine = { pos: number; at: number; text: string; source: string; pinned: boolean; redacted: boolean; supersededBy: number | null }

export type NoteResult = { ok: true; pos: number; duplicate?: true } | { ok: false; error: string }

export type AppendOptions = { ref?: string; card?: CardTag | null }

type Row = { pos: number; at: number; text: string; source: string; pinned: number; redacted: number; ref: string; superseded_by: number | null; card: string | null }

const LIVE = "redacted = 0 AND superseded_by IS NULL"

const FILLER = new Set(["a", "an", "the", "is", "are", "was", "were", "s", "that", "now"])

const STOP = new Set(["and", "but", "for", "with", "you", "your", "she", "her", "his", "him", "they", "them", "this", "what", "have", "has", "had", "not", "will", "just", "from", "into", "about", "like", "really", "very", "can", "could", "would", "should"])

export const norm = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter((w) => !FILLER.has(w))
    .join(" ")

export const keywords = (text: string): string[] => [...new Set(norm(text).split(" ").filter((w) => w.length >= 3 && !STOP.has(w)))]

const LIFE_TREE = "life_tree"

// The life log's tables, with its tree's. Its object's schema list spreads these.
export const LIFE_STEPS: Step[] = [
  `CREATE TABLE IF NOT EXISTS life (
    pos INTEGER PRIMARY KEY,
    at INTEGER NOT NULL,
    text TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    norm TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    redacted INTEGER NOT NULL DEFAULT 0,
    ref TEXT NOT NULL DEFAULT '',
    superseded_by INTEGER,
    card TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS life_norm ON life (norm)",
  "CREATE INDEX IF NOT EXISTS life_ref ON life (ref)",
  "CREATE VIRTUAL TABLE IF NOT EXISTS life_fts USING fts5(text)",
  ...treeSteps(LIFE_TREE),
]

// The substring index for recall. It is its own list so an object can append it at the end of its schema: a step
// placed in the middle of LIFE_STEPS would shift the version of every step after it.
export const LIFE_TRI_STEPS: Step[] = [
  "CREATE VIRTUAL TABLE IF NOT EXISTS life_tri USING fts5(text, tokenize = 'trigram')",
  "INSERT INTO life_tri (rowid, text) SELECT pos, text FROM life WHERE redacted = 0 AND pos NOT IN (SELECT rowid FROM life_tri)",
]

export class Life {
  readonly tree: Tree

  constructor(
    private readonly sql: SqlStorage,
    private readonly transaction: <T>(fn: () => T) => T,
    private readonly settings: { get(key: string): string | null; set(key: string, value: string): void },
  ) {
    this.tree = new Tree(sql, LIFE_TREE, LIFE_SHAPE, (lo, hi) => this.items(lo, hi))
  }

  count(): number {
    const n = this.sql.exec<{ n: number | null }>("SELECT max(pos) AS n FROM life").one().n
    return n === null ? 0 : n + 1
  }

  append(text: string, source: string, at = Date.now(), options: AppendOptions = {}): NoteResult {
    const line = text.replace(/\s+/g, " ").trim()
    if (!line) return { ok: false, error: "empty. a memory is one line of text." }
    if (new TextEncoder().encode(line).byteLength > LINE_BYTES) return { ok: false, error: `too long: a memory is at most ${LINE_BYTES} bytes. say it shorter.` }
    const key = norm(line)
    return this.transaction(() => {
      const same = this.sql.exec<{ pos: number; card: string | null }>(`SELECT pos, card FROM life WHERE norm = ? AND ${LIVE}`, key).toArray()[0]
      if (same) {
        if (options.card && !same.card) this.sql.exec("UPDATE life SET card = ? WHERE pos = ?", options.card, same.pos)
        return { ok: true, pos: same.pos, duplicate: true } as const
      }
      const pos = this.count()
      this.sql.exec(
        "INSERT INTO life (pos, at, text, source, norm, ref, card) VALUES (?, ?, ?, ?, ?, ?, ?)",
        pos,
        at,
        line,
        source,
        key,
        options.ref ?? "",
        options.card ?? null,
      )
      this.sql.exec("INSERT INTO life_fts (rowid, text) VALUES (?, ?)", pos, line)
      this.sql.exec("INSERT INTO life_tri (rowid, text) VALUES (?, ?)", pos, line)
      return { ok: true, pos } as const
    })
  }

  items(lo: number, hi: number): Item[] {
    return this.sql
      .exec<Row>("SELECT pos, at, text, source, redacted, superseded_by FROM life WHERE pos >= ? AND pos < ? ORDER BY pos", lo, hi)
      .toArray()
      .map((r) => ({
        pos: r.pos,
        at: r.at,
        text: r.redacted ? "(removed by the human)" : r.superseded_by !== null ? `(replaced, see #${r.superseded_by})` : `${r.source ? `${r.source}: ` : ""}${r.text}`,
      }))
  }

  card(): { pos: number; text: string; pinned: boolean }[] {
    const pins = this.sql.exec<Row>(`SELECT pos, text FROM life WHERE pinned = 1 AND ${LIVE} ORDER BY pos`).toArray()
    const tagged = this.sql
      .exec<Row>(`SELECT pos, text FROM life WHERE card IS NOT NULL AND pinned = 0 AND ${LIVE} ORDER BY pos DESC LIMIT ?`, Math.max(0, CARD_MAX - pins.length))
      .toArray()
    return [...pins.map((r) => ({ pos: r.pos, text: r.text, pinned: true })), ...tagged.map((r) => ({ pos: r.pos, text: r.text, pinned: false }))].slice(0, CARD_MAX)
  }

  view(now: number): string {
    const prev = this.settings.get(TILING_KEY)
    const { lines, tiling } = this.tree.view(this.count(), prev ? (JSON.parse(prev) as Span[]) : null, now)
    if (JSON.stringify(tiling) !== prev) this.settings.set(TILING_KEY, JSON.stringify(tiling))
    return [...this.card().map((c) => `${c.pinned ? "pinned" : "card"}: ${c.text}`), ...lines].join("\n")
  }

  recall(query: string, limit = 10, options: { skipCard?: boolean } = {}): LifeLine[] {
    const words = query.split(/\s+/).map((w) => w.replaceAll('"', "")).filter(Boolean).slice(0, 12)
    if (!words.length) return []
    const skip = JSON.stringify(options.skipCard ? this.card().map((c) => c.pos) : [])
    const match = words.map((w) => `"${w}"*`).join(" OR ")
    let rows = this.sql
      .exec<Row>(
        "SELECT l.* FROM life_fts f JOIN life l ON l.pos = f.rowid WHERE life_fts MATCH ? AND l.redacted = 0 AND l.superseded_by IS NULL AND l.pos NOT IN (SELECT value FROM json_each(?)) ORDER BY bm25(life_fts), l.pos DESC LIMIT ?",
        match,
        skip,
        limit,
      )
      .toArray()
    const longest = (words.map((w) => w.replace(/[%_\\]/g, "")).sort((a, b) => b.length - a.length)[0] ?? "").slice(0, 40)
    if (!rows.length && longest.length > 2) {
      // A trigram index finds the substring. A LIKE scan read the whole life log on every miss.
      rows = this.sql
        .exec<Row>(
          `SELECT l.* FROM life_tri t JOIN life l ON l.pos = t.rowid WHERE life_tri MATCH ? AND l.redacted = 0 AND l.superseded_by IS NULL AND l.pos NOT IN (SELECT value FROM json_each(?)) ORDER BY l.pos DESC LIMIT ?`,
          `"${longest}"`,
          skip,
          limit,
        )
        .toArray()
    }
    return rows.map(toLine)
  }

  nearest(text: string, limit: number): LifeLine[] {
    const words = keywords(text)
    const hits = words.length ? this.recall(words.join(" "), limit) : []
    const card = this.card().map((c) => c.pos)
    // The loop below stops at `limit` lines, and at most `hits` of the rows it reads are already in `out`, so
    // `limit` rows are enough. Without the LIMIT every call read the whole life log.
    const rows = this.sql
      .exec<Row>(`SELECT * FROM life WHERE ${LIVE} AND (pos IN (SELECT value FROM json_each(?)) OR pos >= ?) ORDER BY pos DESC LIMIT ?`, JSON.stringify(card), this.count() - limit, limit)
      .toArray()
    const out = new Map(hits.map((l) => [l.pos, l]))
    for (const r of rows) if (out.size < limit && !out.has(r.pos)) out.set(r.pos, toLine(r))
    return [...out.values()]
  }

  supersede(oldPos: number, newPos: number): boolean {
    if (oldPos === newPos) return false
    return this.transaction(() => {
      const old = this.sql.exec<{ pinned: number }>(`SELECT pinned FROM life WHERE pos = ? AND ${LIVE}`, oldPos).toArray()[0]
      if (!old || !this.sql.exec(`SELECT 1 FROM life WHERE pos = ? AND ${LIVE}`, newPos).toArray().length) return false
      this.sql.exec("UPDATE life SET superseded_by = ?, pinned = 0 WHERE pos = ?", newPos, oldPos)
      if (old.pinned) this.sql.exec("UPDATE life SET pinned = 1 WHERE pos = ?", newPos)
      this.tree.forget(oldPos)
      return true
    })
  }

  redactRefs(refs: readonly string[]): number[] {
    if (!refs.length) return []
    return this.transaction(() => {
      const gone = this.sql
        .exec<{ pos: number }>("SELECT pos FROM life WHERE redacted = 0 AND ref IN (SELECT value FROM json_each(?))", JSON.stringify(refs))
        .toArray()
        .map((r) => r.pos)
      for (const pos of gone) this.wipe(pos)
      this.restoreSuperseded(gone)
      return gone
    })
  }

  refsLike(prefix: string): string[] {
    return this.sql
      .exec<{ ref: string }>("SELECT DISTINCT ref FROM life WHERE ref >= ? AND ref < ? AND redacted = 0", prefix, `${prefix}\u{10FFFF}`)
      .toArray()
      .map((r) => r.ref)
  }

  zoom(span: Span, now: number): string[] {
    return this.tree.zoom(span, this.count(), now)
  }

  list(before: number | null, limit: number): LifeLine[] {
    return this.sql
      .exec<Row>("SELECT * FROM life WHERE pos < ? ORDER BY pos DESC LIMIT ?", before ?? Number.MAX_SAFE_INTEGER, Math.min(Math.max(limit, 1), 200))
      .toArray()
      .map(toLine)
  }

  pin(pos: number, pinned: boolean): { ok: true } | { ok: false; error: string } {
    const row = this.sql.exec<Row>("SELECT * FROM life WHERE pos = ?", pos).toArray()[0]
    if (!row || row.redacted) return { ok: false, error: "no such memory" }
    if (pinned && !row.pinned && this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM life WHERE pinned = 1").one().n >= MAX_PINS) {
      return { ok: false, error: `at most ${MAX_PINS} pinned memories. unpin one first.` }
    }
    this.sql.exec("UPDATE life SET pinned = ? WHERE pos = ?", pinned ? 1 : 0, pos)
    return { ok: true }
  }

  forgetRevision(): number {
    return Number(this.settings.get("life_forget_revision") ?? 0)
  }

  // Old chat remains readable, but deleting saved memory must not let its queued source save it again.
  captureAllowed(at: number): boolean {
    const cutoff = this.settings.get("life_capture_cutoff")
    return cutoff === null || at > Number(cutoff)
  }

  redact(pos: number): boolean {
    return this.transaction(() => {
      if (!this.wipe(pos)) return false
      this.restoreSuperseded([pos])
      return true
    })
  }

  private wipe(pos: number): boolean {
    const done = this.sql.exec("UPDATE life SET text = '', norm = '', redacted = 1, pinned = 0, card = NULL WHERE pos = ? AND redacted = 0", pos).rowsWritten > 0
    if (!done) return false
    this.settings.set("life_forget_revision", String(this.forgetRevision() + 1))
    this.settings.set("life_capture_cutoff", String(Date.now()))
    this.sql.exec("DELETE FROM life_fts WHERE rowid = ?", pos)
    this.sql.exec("DELETE FROM life_tri WHERE rowid = ?", pos)
    this.tree.forget(pos)
    return true
  }

  private restoreSuperseded(pos: readonly number[]): void {
    const back = this.sql.exec<{ pos: number }>("SELECT pos FROM life WHERE redacted = 0 AND superseded_by IN (SELECT value FROM json_each(?))", JSON.stringify(pos)).toArray()
    for (const r of back) {
      this.sql.exec("UPDATE life SET superseded_by = NULL WHERE pos = ?", r.pos)
      this.tree.forget(r.pos)
    }
  }

  pending(limit: number): Span[] {
    return this.tree.pending(region(this.count(), LIFE_SHAPE), limit)
  }

  prompt(span: Span): string | null {
    const input = this.tree.input(span)
    return input && this.tree.free(input) === null ? napPrompt(input, "memories") : null
  }

  settle(span: Span, text: string | null): void {
    const input = this.tree.input(span)
    if (input) this.tree.put(span, this.tree.nodeFor(input, text ?? this.tree.free(input) ?? this.tree.fallback(input)))
  }
}

function toLine(r: Row): LifeLine {
  return { pos: r.pos, at: r.at, text: r.text, source: r.source, pinned: r.pinned === 1, redacted: r.redacted === 1, supersededBy: r.superseded_by }
}
