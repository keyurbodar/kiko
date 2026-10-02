import type { Envelope, Sender } from "@kiko/protocol"

// Architecture section 7.3. The inbox stores every envelope the room delivers. Rows are never
// deleted when they are drained, because the id is the dedupe key: a delivery repeated after its
// run finished must still store nothing. A drained row carries the `request_id` of the input it
// went into, and `submitted` turns 1 once `pi-durable` admitted that input.
//
// Architecture section 23 (Rivet `actor/queue.rs`). A claimed batch is in flight from the moment a
// run takes it until `submitted`. A batch in flight is not handed out again, unless the process that
// took it is gone (a Durable Object has one live process, so another process's mark is a dead run)
// or it has been in flight for `RECLAIM_MS`. `submitted` is a no-op the second time. The inbox holds
// at most `MAX_OPEN` rows that wait or are claimed, and one row is at most `MAX_ENTRY_BYTES`. A
// delivery past either cap is refused whole, as data, never as an exception.

/** Human first, then system, then agent (architecture section 7.8). */
const PRIORITY: Record<Sender["kind"], number> = { human: 0, system: 1, agent: 2 }

/** A batch in flight this long is handed out again. */
export const RECLAIM_MS = 5 * 60_000
/** ASSUMPTION: the most rows that wait or are claimed. Submitted rows are kept for dedupe and do not count. */
export const MAX_OPEN = 500
/** ASSUMPTION: the largest envelope plus brief, in UTF-8 bytes. A message is at most 16,000 characters. */
export const MAX_ENTRY_BYTES = 128 * 1024

/** Why a delivery stored nothing. `full`: too many open rows. `too_large`: one entry is past the size cap. */
export type Refusal = "full" | "too_large"

export type Admission = {
  /** Every id of the call when it was stored, none when it was refused. */
  admitted: string[]
  /** The rows this call added. */
  inserted: number
  refused?: Refusal
}

export type Batch = {
  /** A hash of the envelope ids, in drain order. `pi-durable` dedupes a repeated submit by it. */
  requestId: string
  envelopes: Envelope[]
  /** The distinct briefs of the batch's deliveries, oldest first. */
  briefs: string[]
}

type Row = { id: string; envelope: string; brief: string; request_id: string | null }

export class Inbox {
  private readonly sql: SqlStorage
  /** Marks the rows this process took. Another process's mark belongs to a dead run. */
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
    // An inbox made before P1-13 has no in-flight columns.
    const columns = this.sql.exec<{ name: string }>("PRAGMA table_info(inbox)").toArray()
    if (!columns.some((c) => c.name === "in_flight_at")) {
      this.sql.exec("ALTER TABLE inbox ADD COLUMN in_flight_at INTEGER")
      this.sql.exec("ALTER TABLE inbox ADD COLUMN in_flight_by TEXT")
    }
  }

  /**
   * Stores each envelope whose id is new. Returns every id of the call, repeats included, because a
   * receipt means "stored", and `inserted`, the count of rows this call added. A call that would pass
   * a cap stores nothing and returns `refused` with no ids.
   */
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
      let arrival = this.sql.exec<{ n: number | null }>("SELECT max(arrival) AS n FROM inbox").one().n ?? 0
      for (const envelope of fresh.values()) {
        this.sql.exec(
          "INSERT INTO inbox (id, arrival, priority, envelope, brief) VALUES (?, ?, ?, ?, ?)",
          envelope.id,
          ++arrival,
          PRIORITY[envelope.from.kind],
          JSON.stringify(envelope),
          brief,
        )
      }
      return { admitted: envelopes.map((e) => e.id), inserted: fresh.size }
    })
  }

  /**
   * Puts every waiting row into one batch and records its request id, in one transaction. Then takes
   * every claimed batch that is neither submitted nor in flight, the new one included, and marks it in
   * flight. A batch taken by a dead process, or in flight for `RECLAIM_MS`, is taken again with the
   * same request id, so submitting it again is a no-op in `pi-durable`.
   */
  async claim(): Promise<Batch[]> {
    const waiting = this.sql
      .exec<Row>("SELECT id, envelope, brief, request_id FROM inbox WHERE request_id IS NULL ORDER BY priority, arrival")
      .toArray()
    if (waiting.length > 0) {
      const requestId = await requestIdFor(waiting.map((row) => row.id))
      // Rows that arrived during the hash are left for the next claim. The ids are fixed above.
      this.storage.transactionSync(() => {
        for (const row of waiting) this.sql.exec("UPDATE inbox SET request_id = ? WHERE id = ? AND request_id IS NULL", requestId, row.id)
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

  /** Marks a batch as admitted by `pi-durable`. Returns false when it was marked before, so a repeat does nothing. */
  submitted(requestId: string): boolean {
    const cursor = this.sql.exec(
      "UPDATE inbox SET submitted = 1, in_flight_at = NULL, in_flight_by = NULL WHERE request_id = ? AND submitted = 0",
      requestId,
    )
    return cursor.rowsWritten > 0
  }

  /** Hands one batch back without submitting it: the run is busy and the batch waits for it to answer (section 7.8). */
  hold(requestId: string): void {
    this.sql.exec("UPDATE inbox SET in_flight_at = NULL, in_flight_by = NULL WHERE request_id = ? AND submitted = 0", requestId)
  }

  /** True when a row waits or is claimed and not yet submitted. */
  hasOpen(): boolean {
    return this.sql.exec("SELECT 1 FROM inbox WHERE submitted = 0 LIMIT 1").toArray().length > 0
  }

  /** Hands back every batch this process holds after a failed drain, so the next claim takes it at once. */
  release(): void {
    this.sql.exec("UPDATE inbox SET in_flight_at = NULL, in_flight_by = NULL WHERE submitted = 0 AND in_flight_by = ?", this.process)
  }

  /**
   * The human pressed stop (section 6.2). Every row not yet submitted is closed without a run. The
   * rows stay, so a repeated delivery of a discarded envelope still stores nothing. Returns the count.
   */
  discard(): number {
    return this.sql.exec(
      "UPDATE inbox SET request_id = coalesce(request_id, 'stopped'), submitted = 1, in_flight_at = NULL, in_flight_by = NULL WHERE submitted = 0",
    ).rowsWritten
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

/** `inbox:` and the hex SHA-256 of the ids joined by newlines. */
export async function requestIdFor(ids: readonly string[]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ids.join("\n")))
  return `inbox:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}`
}

/** Escapes markup, so message text cannot close or forge a tag. */
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

/**
 * The text of one submitted input. The brief comes first as a `<context>` block (section 7.4). Human
 * text is plain. Agent and system text is wrapped and escaped (section 16.2).
 */
export function renderInput(batch: Pick<Batch, "envelopes" | "briefs">): string {
  const parts = batch.briefs.map((brief) => `<context>\n${brief.replaceAll("</context>", "&lt;/context>")}\n</context>`)
  for (const { from, body, hop, tainted } of batch.envelopes) {
    // A tainted envelope starts a tainted run: the trust extension reads this attribute (section 16.3).
    const taint = tainted ? ' tainted="true"' : ""
    if (from.kind === "human") parts.push(body)
    else if (from.kind === "agent") parts.push(`<agent-message from="${from.slug}" hop="${hop}"${taint}>\n${escape(body)}\n</agent-message>`)
    else parts.push(`<system-event reason="${from.reason}"${taint}>\n${escape(body)}\n</system-event>`)
  }
  // The ids of the human's messages, so `[react:<emoji>:<id>]` can target one that is not the newest.
  const ids = batch.envelopes.flatMap((e) => (e.from.kind === "human" && e.id.startsWith("human:") ? [`${e.id.slice(6)}: ${escape(e.body.slice(0, 40))}`] : []))
  if (ids.length > 1) parts.push(`<context>\nmessage ids, oldest first:\n${ids.join("\n")}\n</context>`)
  return parts.join("\n\n")
}
