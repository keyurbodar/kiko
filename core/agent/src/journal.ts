import type { Context } from "@earendil-works/chord"
import { type Id, type Seq, type StorageWrite } from "@earendil-works/pi-durable"
import { MemoryStorage } from "@earendil-works/pi-durable/storage/memory"
import type { Step } from "@kiko/durable/migrate"

export const JOURNAL_STEPS: Step[] = [
  `CREATE TABLE IF NOT EXISTS journal (
    agent TEXT NOT NULL,
    seq INTEGER NOT NULL,
    part INTEGER NOT NULL CHECK (part >= 0),
    parts INTEGER NOT NULL CHECK (parts > 0),
    bytes INTEGER NOT NULL CHECK (bytes > 0),
    data BLOB NOT NULL,
    PRIMARY KEY (agent, seq, part)
  ) WITHOUT ROWID, STRICT`,
  "CREATE TABLE IF NOT EXISTS journal_ids (agent TEXT PRIMARY KEY, next_id INTEGER NOT NULL) WITHOUT ROWID, STRICT",
]

const PART_BYTES = 1_500_000
const ID_RANGE = 1024
const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false })
type Envelope = { seq: Seq; writes: readonly StorageWrite[] }
type Row = { seq: number; part: number; parts: number; bytes: number; data: ArrayBuffer }

// One namespace belongs to one Harness, including all its worker conversations and their shared allocator.
export class JournalStorage extends MemoryStorage {
  private tail: Promise<unknown> = Promise.resolve()
  private nextCandidate = 2
  private reservedUntil = 2
  private finished = false

  private constructor(private readonly durable: DurableObjectStorage, private readonly key: string) {
    super()
  }

  static open(storage: DurableObjectStorage, key: string): JournalStorage {
    const journal = new JournalStorage(storage, key)
    journal.reservedUntil = storage.sql.exec<{ next_id: number }>("SELECT next_id FROM journal_ids WHERE agent = ?", key).toArray()[0]?.next_id ?? 2
    journal.nextCandidate = journal.reservedUntil
    let group: Row[] = []
    const replay = () => {
      const first = group[0]
      if (!first) return
      if (group.length !== first.parts) throw new Error("Incomplete journal commit")
      const bytes = new Uint8Array(first.bytes)
      let offset = 0
      for (const [part, row] of group.entries()) {
        if (row.part !== part || row.parts !== first.parts || row.bytes !== first.bytes) throw new Error("Invalid journal parts")
        const chunk = new Uint8Array(row.data)
        bytes.set(chunk, offset)
        offset += chunk.length
      }
      if (offset !== bytes.length) throw new Error("Invalid journal byte length")
      const envelope: Envelope = JSON.parse(decoder.decode(bytes))
      if (envelope.seq !== first.seq || !Array.isArray(envelope.writes)) throw new Error("Invalid journal envelope")
      journal.prepareCommit(envelope.writes, envelope.seq).apply()
      journal.observeIds(envelope.writes)
      group = []
    }
    for (const row of storage.sql.exec<Row>("SELECT seq, part, parts, bytes, data FROM journal WHERE agent = ? ORDER BY seq, part", key)) {
      if (group[0] && group[0].seq !== row.seq) replay()
      group.push(row)
    }
    replay()
    return journal
  }

  // The owner closes the Harness before clearing its namespace at the existing compaction boundary.
  static clear(storage: DurableObjectStorage, key: string): void {
    storage.sql.exec("DELETE FROM journal WHERE agent = ?", key).toArray()
  }

  override commit(writes: readonly StorageWrite[], _context: Context): Promise<Seq> {
    return this.serial(async () => {
      const prepared = this.prepareCommit(writes)
      this.append({ seq: prepared.seq, writes: prepared.writes })
      const seq = prepared.apply()
      this.observeIds(prepared.writes)
      return seq
    })
  }

  override mintId<I extends Id<string>>(): Promise<I> {
    return this.serial(async () => {
      if (this.finished) throw new Error("Storage is closed")
      if (this.nextCandidate >= this.reservedUntil) {
        this.durable.transactionSync(() => {
          const persisted = this.durable.sql.exec<{ next_id: number }>("SELECT next_id FROM journal_ids WHERE agent = ?", this.key).toArray()[0]?.next_id ?? 2
          const start = Math.max(this.nextCandidate, persisted)
          if (!Number.isSafeInteger(start)) throw new Error("ID space is exhausted")
          const end = Math.min(start + ID_RANGE, Number.MAX_SAFE_INTEGER + 1)
          this.durable.sql.exec("INSERT INTO journal_ids (agent, next_id) VALUES (?, ?) ON CONFLICT(agent) DO UPDATE SET next_id = excluded.next_id", this.key, end)
          this.nextCandidate = start
          this.reservedUntil = end
        })
      }
      const value = this.nextCandidate++
      return value as I
    })
  }

  override close(context: Context): Promise<void> {
    return this.serial(async () => {
      await super.close(context)
      this.finished = true
    })
  }

  private observeIds(writes: readonly StorageWrite[]): void {
    for (const write of writes) {
      const id = write.type === "document.create" || write.type === "document.copy" ? write.record.id
        : write.type === "document.change" || write.type === "document.retire" ? write.id : write.value.id
      this.nextCandidate = Math.max(this.nextCandidate, id + 1)
    }
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation)
    this.tail = result.catch(() => {})
    return result
  }

  private append(envelope: Envelope): void {
    const bytes = encoder.encode(JSON.stringify(envelope))
    const parts = Math.ceil(bytes.length / PART_BYTES)
    this.durable.transactionSync(() => {
      for (let part = 0; part < parts; part++) {
        this.durable.sql.exec(
          "INSERT INTO journal (agent, seq, part, parts, bytes, data) VALUES (?, ?, ?, ?, ?, ?)",
          this.key, envelope.seq, part, parts, bytes.length, bytes.slice(part * PART_BYTES, (part + 1) * PART_BYTES),
        ).toArray()
      }
    })
  }

}
