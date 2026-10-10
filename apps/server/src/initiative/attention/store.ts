import { type Appetite, emptyAppetite, learn, nudged, type Outcome, settle } from "./appetite"
import { emptyRhythm, ignoreDeadline, type Rhythm, record } from "./rhythm"
import type { Kind, Signal } from "./types"

/** Signal ids are kept this long to drop a redelivery of the same batch. */
const SEEN_FOR = 7 * 86_400_000

/**
 * Attention state for one user, in `UserDO`'s SQLite. The rhythm and the appetite are each one JSON
 * row in `attention`; `attention_seen` holds recent signal ids, because the bus delivers at least
 * once and a burst counted twice would skew the rhythm.
 */
export class AttentionStore {
  constructor(private readonly sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS attention (name TEXT PRIMARY KEY, value TEXT NOT NULL)")
    sql.exec("CREATE TABLE IF NOT EXISTS attention_seen (id TEXT PRIMARY KEY, at INTEGER NOT NULL)")
  }

  rhythm(): Rhythm {
    return this.#get("rhythm") ?? emptyRhythm()
  }

  appetite(): Appetite {
    return this.#get("appetite") ?? emptyAppetite()
  }

  /**
   * Read one batch from the signal bus: each new human burst goes into the rhythm, then pending
   * nudges are settled. Returns the outcomes, so the caller can count an ignore on the loop or drop
   * a dismissed one. Safe to call twice with the same batch.
   */
  observe(signals: readonly Signal[], now: number, tz: string): Outcome[] {
    this.sql.exec("DELETE FROM attention_seen WHERE at < ?", now - SEEN_FOR)
    const seen = new Set(
      this.sql
        .exec<{ id: string }>("SELECT id FROM attention_seen WHERE id IN (SELECT value FROM json_each(?))", JSON.stringify(signals.map((s) => s.id)))
        .toArray()
        .map((r) => r.id),
    )
    const fresh = signals.filter((s) => !seen.has(s.id))
    let rhythm = this.rhythm()
    for (const s of fresh) if (s.kind === "burst") rhythm = record(rhythm, s.at, tz)
    const { appetite, outcomes } = settle(this.appetite(), fresh, now)
    this.#put("rhythm", rhythm)
    this.#put("appetite", appetite)
    for (const s of fresh) this.sql.exec("INSERT OR IGNORE INTO attention_seen (id, at) VALUES (?, ?)", s.id, now)
    return outcomes
  }

  /** The ids among `ids` that no batch has brought yet. */
  unseen(ids: readonly string[]): Set<string> {
    if (!ids.length) return new Set()
    const seen = new Set(this.sql.exec<{ id: string }>("SELECT id FROM attention_seen WHERE id IN (SELECT value FROM json_each(?))", JSON.stringify(ids)).toArray().map((r) => r.id))
    return new Set(ids.filter((id) => !seen.has(id)))
  }

  /** Record a nudge that went out, with its ignore deadline read from the rhythm. Idempotent by id. */
  sent(n: { id: string; room: string; kind: Kind; loop: string; at: number }, tz: string): void {
    const deadline = ignoreDeadline(this.rhythm(), n.at, tz)
    this.#put("appetite", nudged(this.appetite(), { ...n, deadline }))
  }

  /** The agent answered a wake with [skip]: the kind learns it, the human's own appetite does not. */
  skipped(kind: Kind, at: number): void {
    this.#put("appetite", learn(this.appetite(), kind, "skipped", at))
  }

  /** Development only: move every pending nudge `ms` into the past, as if that much time went by. */
  devShift(ms: number): void {
    const app = this.appetite()
    this.#put("appetite", { ...app, pending: app.pending.map((p) => ({ ...p, at: p.at - ms, deadline: p.deadline - ms, ...(p.engaged === undefined ? {} : { engaged: p.engaged - ms }) })) })
  }

  /** Development only: replace the rhythm. */
  devRhythm(r: Rhythm): void {
    this.#put("rhythm", r)
  }

  #get<T>(name: string): T | undefined {
    const row = this.sql.exec<{ value: string }>("SELECT value FROM attention WHERE name = ?", name).toArray()[0]
    return row ? (JSON.parse(row.value) as T) : undefined
  }

  #put(name: string, value: unknown): void {
    this.sql.exec("INSERT INTO attention (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value", name, JSON.stringify(value))
  }
}
