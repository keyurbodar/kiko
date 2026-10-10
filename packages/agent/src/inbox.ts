import type { Envelope, Sender } from "./envelope"

const PRIORITY: Record<Sender["kind"], number> = { human: 0, system: 1, agent: 2 }

export const RECLAIM_MS = 5 * 60_000
export const MAX_OPEN = 500
export const MAX_ENTRY_BYTES = 128 * 1024

export const KEEP_SUBMITTED_MS = 7 * 86_400_000
const PRUNE_EVERY_MS = 3_600_000

export type Refusal = "full" | "too_large"

export type Admission = {
  admitted: string[]
  inserted: number
  refused?: Refusal
}

export type Batch = {
  requestId: string
  envelopes: Envelope[]
  briefs: string[]
}

type Row = { id: string; envelope: string; brief: string; request_id: string | null }

export class Inbox {
  private readonly sql: SqlStorage
  private readonly process = crypto.randomUUID()

  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly now: () => number = Date.now,
  ) {
    this.sql = storage.sql
    this.sql.exec(`CREATE TABLE IF NOT EXISTS inbox (
      id TEXT PRIMARY KEY,
      arrival INTEGER NOT NULL,
      priority INTEGER NOT NULL,
      envelope TEXT NOT NULL,
      brief TEXT NOT NULL,
      request_id TEXT,
      submitted INTEGER NOT NULL DEFAULT 0,
      in_flight_at INTEGER,
      in_flight_by TEXT
    ) STRICT`)
    this.sql.exec("CREATE INDEX IF NOT EXISTS inbox_open ON inbox (submitted, request_id, priority, arrival)")
    const columns = this.sql.exec<{ name: string }>("PRAGMA table_info(inbox)").toArray()
    if (!columns.some((c) => c.name === "in_flight_at")) {
      this.sql.exec("ALTER TABLE inbox ADD COLUMN in_flight_at INTEGER")
      this.sql.exec("ALTER TABLE inbox ADD COLUMN in_flight_by TEXT")
    }
    if (!columns.some((c) => c.name === "at")) {
      this.sql.exec("ALTER TABLE inbox ADD COLUMN at INTEGER")
      this.sql.exec("UPDATE inbox SET at = ?", this.now())
    }
    this.sql.exec("CREATE TABLE IF NOT EXISTS inbox_state (id INTEGER PRIMARY KEY CHECK (id = 1), arrival INTEGER NOT NULL, pruned_at INTEGER NOT NULL)")
    if (!this.sql.exec("SELECT 1 FROM inbox_state WHERE id = 1").toArray().length) {
      this.sql.exec("INSERT INTO inbox_state (id, arrival, pruned_at) SELECT 1, coalesce(max(arrival), 0), ? FROM inbox", this.now())
    }
  }

  admit(envelopes: readonly Envelope[], brief: string): Admission {
    return this.storage.transactionSync(() => {
      const fresh = new Map<string, Envelope>()
      for (const e of envelopes) {
        if (!fresh.has(e.id) && this.sql.exec("SELECT 1 FROM inbox WHERE id = ?", e.id).toArray().length === 0) fresh.set(e.id, e)
      }
      const briefBytes = utf8(brief)
      for (const e of fresh.values()) {
        if (utf8(JSON.stringify(e)) + briefBytes > MAX_ENTRY_BYTES) return { admitted: [], inserted: 0, refused: "too_large" }
      }
      const open = this.sql.exec<{ n: number }>("SELECT count(*) AS n FROM inbox WHERE submitted = 0").one().n
      if (open + fresh.size > MAX_OPEN) return { admitted: [], inserted: 0, refused: "full" }
      const state = this.sql.exec<{ arrival: number; pruned_at: number }>("SELECT arrival, pruned_at FROM inbox_state WHERE id = 1").one()
      let arrival = state.arrival
      const now = this.now()
      const briefed = new Set<boolean>()
      for (const envelope of fresh.values()) {
        const human = envelope.from.kind === "human"
        this.sql.exec(
          "INSERT INTO inbox (id, arrival, priority, envelope, brief, at) VALUES (?, ?, ?, ?, ?, ?)",
          envelope.id,
          ++arrival,
          PRIORITY[envelope.from.kind],
          JSON.stringify(envelope),
          briefed.has(human) ? "" : brief,
          now,
        )
        briefed.add(human)
      }
      if (fresh.size) this.sql.exec("UPDATE inbox_state SET arrival = ? WHERE id = 1", arrival)
      if (now - state.pruned_at >= PRUNE_EVERY_MS) this.prune(now)
      return { admitted: envelopes.map((e) => e.id), inserted: fresh.size }
    })
  }

  async claim(): Promise<Batch[]> {
    const waiting = this.sql
      .exec<Row & { priority: number }>("SELECT id, envelope, brief, request_id, priority FROM inbox WHERE submitted = 0 AND request_id IS NULL ORDER BY priority, arrival")
      .toArray()
    const groups = [waiting.filter((r) => r.priority === PRIORITY.human), waiting.filter((r) => r.priority !== PRIORITY.human)].filter((g) => g.length)
    const ids = await Promise.all(groups.map((g) => requestIdFor(g.map((row) => row.id))))
    if (groups.length) {
      this.storage.transactionSync(() => {
        groups.forEach((g, i) => {
          for (const row of g) this.sql.exec("UPDATE inbox SET request_id = ? WHERE id = ? AND request_id IS NULL", ids[i]!, row.id)
        })
      })
    }
    const now = this.now()
    const open = this.storage.transactionSync(() => {
      const rows = this.sql
        .exec<Row>(
          `SELECT id, envelope, brief, request_id FROM inbox
          WHERE submitted = 0 AND request_id IS NOT NULL
            AND (in_flight_at IS NULL OR in_flight_by IS NOT ? OR in_flight_at <= ?)
          ORDER BY priority, arrival`,
          this.process,
          now - RECLAIM_MS,
        )
        .toArray()
      for (const row of rows) this.sql.exec("UPDATE inbox SET in_flight_at = ?, in_flight_by = ? WHERE id = ?", now, this.process, row.id)
      return rows
    })
    const batches = new Map<string, Batch>()
    for (const row of open) {
      const batch = batches.get(row.request_id!) ?? { requestId: row.request_id!, envelopes: [], briefs: [] }
      batch.envelopes.push(JSON.parse(row.envelope) as Envelope)
      if (row.brief && !batch.briefs.includes(row.brief)) batch.briefs.push(row.brief)
      batches.set(batch.requestId, batch)
    }
    return [...batches.values()]
  }

  submitted(requestId: string): boolean {
    const cursor = this.sql.exec(
      "UPDATE inbox SET submitted = 1, in_flight_at = NULL, in_flight_by = NULL WHERE request_id = ? AND submitted = 0",
      requestId,
    )
    return cursor.rowsWritten > 0
  }

  hold(requestId: string): void {
    this.sql.exec("UPDATE inbox SET request_id = NULL, in_flight_at = NULL, in_flight_by = NULL WHERE request_id = ? AND submitted = 0", requestId)
  }

  envelopeIds(requestId: string): string[] {
    return this.sql.exec<{ id: string }>("SELECT id FROM inbox WHERE request_id = ? ORDER BY priority, arrival", requestId).toArray().map((r) => r.id)
  }

  private prune(now: number): void {
    this.sql.exec("DELETE FROM inbox WHERE submitted = 1 AND at < ?", now - KEEP_SUBMITTED_MS)
    this.sql.exec("UPDATE inbox_state SET pruned_at = ? WHERE id = 1", now)
  }

  humanWaiting(): boolean {
    return this.sql.exec("SELECT 1 FROM inbox WHERE submitted = 0 AND priority = ? LIMIT 1", PRIORITY.human).toArray().length > 0
  }

  hasOpen(): boolean {
    return this.sql.exec("SELECT 1 FROM inbox WHERE submitted = 0 LIMIT 1").toArray().length > 0
  }

  release(): void {
    this.sql.exec("UPDATE inbox SET in_flight_at = NULL, in_flight_by = NULL WHERE submitted = 0 AND in_flight_by = ?", this.process)
  }

  /** Stop clears what agents sent. A human's message that has not started a run stays, so it is still answered. */
  discard(): number {
    const where = "submitted = 0 AND (priority != ? OR in_flight_at IS NOT NULL)"
    const n = this.sql.exec<{ n: number }>(`SELECT count(*) AS n FROM inbox WHERE ${where}`, PRIORITY.human).one().n
    this.sql.exec(`UPDATE inbox SET request_id = coalesce(request_id, 'stopped'), submitted = 1, in_flight_at = NULL, in_flight_by = NULL WHERE ${where}`, PRIORITY.human)
    return n
  }

  counts(): { waiting: number; claimed: number; submitted: number } {
    return this.sql
      .exec<{ waiting: number; claimed: number; submitted: number }>(
        `SELECT
          coalesce(sum(request_id IS NULL), 0) AS waiting,
          coalesce(sum(request_id IS NOT NULL AND submitted = 0), 0) AS claimed,
          coalesce(sum(submitted), 0) AS submitted
        FROM inbox`,
      )
      .one()
  }
}

const encoder = new TextEncoder()
const utf8 = (text: string) => encoder.encode(text).byteLength

export async function requestIdFor(ids: readonly string[]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ids.join("\n")))
  return `inbox:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}`
}

const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

export function renderInput(batch: Pick<Batch, "envelopes" | "briefs">, memory?: string): string {
  const parts = [...(memory ? [memory] : []), ...batch.briefs.map((brief) => `<context>\n${brief.replaceAll("</context>", "&lt;/context>")}\n</context>`)]
  for (const { from, body, hop, tainted } of batch.envelopes) {
    const taint = tainted ? ' tainted="true"' : ""
    if (from.kind === "human") parts.push(body)
    else if (from.kind === "agent") parts.push(`<agent-message from="${from.slug}" hop="${hop}"${taint}>\n${escape(body)}\n</agent-message>`)
    else parts.push(`<system-event reason="${from.reason}"${taint}>\n${escape(body)}\n</system-event>`)
  }
  const human = batch.envelopes.filter((e) => e.from.kind === "human" && e.id.startsWith("human:"))
  if (human.length === 1) parts.push(`<context>message id: ${human[0]!.id.slice(6)}</context>`)
  if (human.length > 1) parts.push(`<context>\nmessage ids, oldest first:\n${human.map((e) => `${e.id.slice(6)}: ${escape(e.body.slice(0, 40))}`).join("\n")}\n</context>`)
  return parts.join("\n\n")
}
