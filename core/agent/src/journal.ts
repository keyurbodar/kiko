import type { Context } from "@earendil-works/chord"
import { LiveDoc, type DocumentId, type Seq, type StorageWrite, type StoredDocument } from "@earendil-works/pi-durable"
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
]

const PART_BYTES = 1_500_000
const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false })
type Prefix = { id: DocumentId; version: number; value: StoredDocument["value"]; count: number }
type Envelope = { seq: Seq; prefix: Prefix[] } & (
  | { kind: "commit"; writes: readonly StorageWrite[] }
  | { kind: "tail" }
)
type Row = { seq: number; part: number; parts: number; bytes: number; data: ArrayBuffer }

// One namespace belongs to one Harness, including all its worker conversations and their shared allocator.
export class JournalStorage extends MemoryStorage {
  private readonly pending = new Map<DocumentId, number>()
  private readonly documents = new Map<DocumentId, { version: number; holdsGeneration: boolean }>()
  private lastSeq: Seq | undefined
  private tail: Promise<unknown> = Promise.resolve()

  private constructor(private readonly durable: DurableObjectStorage, private readonly key: string) {
    super()
  }

  static open(storage: DurableObjectStorage, key: string): JournalStorage {
    const journal = new JournalStorage(storage, key)
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
      if (envelope.seq !== first.seq || (envelope.kind !== "commit" && envelope.kind !== "tail")) throw new Error("Invalid journal envelope")
      journal.replay(envelope)
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

  override commit(writes: readonly StorageWrite[], context: Context): Promise<Seq> {
    return this.serial(async () => {
      const prepared = this.prepareCommit(writes)
      const only = prepared.writes.length === 1 ? prepared.writes[0] : undefined
      if (only?.type === "document.change" && only.content.kind === "delta" && only.content.ops.length > 0 &&
        only.content.ops.every((op) => op[0] !== "r" && op[1][0] === "generation")) {
        const known = this.documents.get(only.id)
        if (known?.holdsGeneration && known.version === only.content.version) {
          this.pending.set(only.id, (this.pending.get(only.id) ?? 0) + 1)
          this.lastSeq = prepared.apply()
          return this.lastSeq
        }
      }
      const prefix = await this.prefix(prepared.writes, context)
      this.append({ kind: "commit", seq: prepared.seq, writes: prepared.writes, prefix })
      this.lastSeq = prepared.apply()
      this.remember(prepared.writes)
      this.pending.clear()
      return this.lastSeq
    })
  }

  override close(context: Context): Promise<void> {
    return this.serial(async () => {
      if (this.pending.size && this.lastSeq !== undefined) {
        this.append({ kind: "tail", seq: this.lastSeq, prefix: await this.prefix([], context) })
        this.pending.clear()
      }
      await super.close(context)
    })
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation)
    this.tail = result.catch(() => {})
    return result
  }

  private async prefix(writes: readonly StorageWrite[], context: Context): Promise<Prefix[]> {
    const superseded = new Set(writes.flatMap((write) =>
      write.type === "document.retire" || (write.type === "document.change" && write.content.kind === "base") ? [write.id] : []))
    const prefix: Prefix[] = []
    for (const [id, count] of this.pending) {
      if (superseded.has(id)) continue
      const stored = await super.document(id, "current", context)
      if (!stored) throw new Error(`Missing buffered document ${id}`)
      prefix.push({ id, version: stored.version, value: stored.value, count })
    }
    return prefix
  }

  private remember(writes: readonly StorageWrite[]): void {
    for (const write of writes) {
      if (write.type === "document.create") {
        this.documents.set(write.record.id, {
          version: write.content.version,
          holdsGeneration: write.record.kind === LiveDoc.definition.kind &&
            (write.record.scope.kind !== "conversation" || write.record.history === "latest"),
        })
      } else if (write.type === "document.retire") this.documents.delete(write.id)
      else if (write.type === "document.change") {
        const known = this.documents.get(write.id)
        if (known) known.version = write.content.version
      }
    }
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

  private replay(envelope: Envelope): void {
    // A replacement delta followed by empty deltas preserves the upstream checkpoint counter.
    // Current-only documents expose no historical values, so the omitted intermediate values are unobservable.
    let seq = envelope.seq - envelope.prefix.reduce((count, doc) => count + doc.count, 0) + (envelope.kind === "tail" ? 1 : 0)
    for (const doc of envelope.prefix) {
      for (let index = 0; index < doc.count; index++) {
        this.prepareCommit([{
          type: "document.change", id: doc.id,
          content: { kind: "delta", version: doc.version, ops: index === 0 ? [["r", doc.value]] : [] },
        }], seq++ as Seq).apply()
      }
    }
    if (envelope.kind === "commit") {
      this.prepareCommit(envelope.writes, envelope.seq).apply()
      this.remember(envelope.writes)
    }
    this.lastSeq = envelope.seq
  }
}
