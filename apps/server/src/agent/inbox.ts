import type { Envelope, Sender } from "@kiko/protocol"

// Architecture section 7.3. The inbox stores every envelope the room delivers. Rows are never
// deleted when they are drained, because the id is the dedupe key: a delivery repeated after its
// run finished must still store nothing. A drained row carries the `request_id` of the input it
// went into, and `submitted` turns 1 once `pi-durable` admitted that input.

/** Human first, then system, then agent (architecture section 7.8). */
const PRIORITY: Record<Sender["kind"], number> = { human: 0, system: 1, agent: 2 }

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

  constructor(private readonly storage: DurableObjectStorage) {
    this.sql = storage.sql
    this.sql.exec(`CREATE TABLE IF NOT EXISTS inbox (
      id TEXT PRIMARY KEY,
      arrival INTEGER NOT NULL,
      priority INTEGER NOT NULL,
      envelope TEXT NOT NULL,
      brief TEXT NOT NULL,
      request_id TEXT,
      submitted INTEGER NOT NULL DEFAULT 0
    ) STRICT`)
    this.sql.exec("CREATE INDEX IF NOT EXISTS inbox_open ON inbox (submitted, request_id, priority, arrival)")
  }

  /**
   * Stores each envelope whose id is new. Returns every id of the call, repeats included, because a
   * receipt means "stored", and `inserted`, the count of rows this call added.
   */
  admit(envelopes: readonly Envelope[], brief: string): { admitted: string[]; inserted: number } {
    return this.storage.transactionSync(() => {
      let inserted = 0
      let arrival = this.sql.exec<{ n: number | null }>("SELECT max(arrival) AS n FROM inbox").one().n ?? 0
      for (const envelope of envelopes) {
        const cursor = this.sql.exec(
          "INSERT OR IGNORE INTO inbox (id, arrival, priority, envelope, brief) VALUES (?, ?, ?, ?, ?)",
          envelope.id,
          arrival + 1,
          PRIORITY[envelope.from.kind],
          JSON.stringify(envelope),
          brief,
        )
        if (cursor.rowsWritten > 0) {
          inserted++
          arrival++
        }
      }
      return { admitted: envelopes.map((e) => e.id), inserted }
    })
  }

  /**
   * Puts every waiting row into one batch and records its request id, in one transaction. Then returns
   * every batch that is not yet submitted, the new one included. A batch claimed before a crash comes
   * back with the same request id, so submitting it again is a no-op in `pi-durable`.
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
    const open = this.sql
      .exec<Row>("SELECT id, envelope, brief, request_id FROM inbox WHERE submitted = 0 AND request_id IS NOT NULL ORDER BY priority, arrival")
      .toArray()
    const batches = new Map<string, Batch>()
    for (const row of open) {
      const batch = batches.get(row.request_id!) ?? { requestId: row.request_id!, envelopes: [], briefs: [] }
      batch.envelopes.push(JSON.parse(row.envelope) as Envelope)
      if (row.brief && !batch.briefs.includes(row.brief)) batch.briefs.push(row.brief)
      batches.set(batch.requestId, batch)
    }
    return [...batches.values()]
  }

  /** Marks a batch as admitted by `pi-durable`. */
  submitted(requestId: string): void {
    this.sql.exec("UPDATE inbox SET submitted = 1 WHERE request_id = ?", requestId)
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
  for (const { from, body, hop } of batch.envelopes) {
    if (from.kind === "human") parts.push(body)
    else if (from.kind === "agent") parts.push(`<agent-message from="${from.slug}" hop="${hop}">\n${escape(body)}\n</agent-message>`)
    else parts.push(`<system-event reason="${from.reason}">\n${escape(body)}\n</system-event>`)
  }
  return parts.join("\n\n")
}
