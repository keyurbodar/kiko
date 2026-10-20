import type { Context } from "@earendil-works/chord"
import type { EntryRecord, Id, Seq, StorageWrite, SubmissionId, SubmissionRecord } from "@earendil-works/pi-durable"
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
const BATCH_BYTES = 1_000_000
const ID_RANGE = 1024
const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false })
type Envelope = { seq: Seq; writes: readonly StorageWrite[] }
type Batch = { seq: Seq; commits: readonly Envelope[] }
type Row = { seq: number; part: number; parts: number; bytes: number; data: ArrayBuffer }
type IdLease = { next: number; end: number }
// Reopening a paused Harness in the same object can finish its already durable reservation.
// A fresh storage object after eviction starts beyond the persisted high watermark.
const idLeases = new WeakMap<DurableObjectStorage, Map<string, IdLease>>()

// One namespace belongs to one Harness, including all its worker conversations and their shared allocator.
export class JournalStorage extends MemoryStorage {
  private tail: Promise<unknown> = Promise.resolve()
  private readonly ids: IdLease
  private input?: EntryRecord
  private checkpoint?: { entry: EntryRecord; submission: SubmissionRecord; seq: Seq }
  humanDeliveredSeq = 0
  private finished = false
  private pending: Envelope[] = []
  private pendingBytes = 0
  private readonly settlements = new Map<SubmissionId, Seq>()

  private constructor(private readonly durable: DurableObjectStorage, private readonly key: string) {
    super()
    let leases = idLeases.get(durable)
    if (!leases) {
      leases = new Map()
      idLeases.set(durable, leases)
    }
    let lease = leases.get(key)
    if (!lease) {
      const end = durable.sql.exec<{ next_id: number }>("SELECT next_id FROM journal_ids WHERE agent = ?", key).toArray()[0]?.next_id ?? 2
      lease = { next: end, end }
      leases.set(key, lease)
    }
    this.ids = lease
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
      const envelope: Envelope | Batch = JSON.parse(decoder.decode(bytes))
      if (envelope.seq !== first.seq) throw new Error("Invalid journal envelope")
      const commits = "commits" in envelope ? envelope.commits : [envelope]
      if (!Array.isArray(commits) || commits.at(-1)?.seq !== envelope.seq) throw new Error("Invalid journal batch")
      for (const commit of commits) {
        if (!Array.isArray(commit.writes)) throw new Error("Invalid journal commit")
        journal.prepareCommit(commit.writes, commit.seq).apply()
        journal.observeIds(commit.writes, commit.seq)
      }
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

  // Keep one terminal bookkeeping input without its model context. No conversation record
  // survives, so Harness.root starts fresh while public submission scans retain delivery.
  static reset(storage: DurableObjectStorage, key: string): void {
    const checkpoint = JournalStorage.open(storage, key).checkpoint
    storage.transactionSync(() => {
      JournalStorage.clear(storage, key)
      if (!checkpoint) return
      const { entry, submission, seq } = checkpoint
      const writes: StorageWrite[] = [
        { type: "entry", value: { id: entry.id, conversationId: entry.conversationId, kind: "kiko.input", data: { humanDeliveredSeq: entry.data && typeof entry.data === "object" && !Array.isArray(entry.data) ? entry.data.humanDeliveredSeq ?? 0 : 0 } } },
        { type: "submission", value: { id: submission.id, conversationId: submission.conversationId, type: "input", status: "unanswered", entry: entry.id, reason: "journal reset checkpoint" } },
      ]
      const journal = new JournalStorage(storage, key)
      journal.append({ seq, commits: [{ seq, writes }] })
    })
  }

  override commit(writes: readonly StorageWrite[], _context: Context): Promise<Seq> {
    return this.serial(async () => {
      const prepared = this.prepareCommit(writes)
      const seq = prepared.apply()
      const envelope = { seq, writes: prepared.writes }
      this.pending.push(envelope)
      this.pendingBytes += encoder.encode(JSON.stringify(envelope)).length
      // The public StorageWrite includes the committed assistant response and usage.
      // Flush on the storage mutation line: publication listeners cannot propagate an I/O failure.
      const boundary = prepared.writes.some((write) =>
        write.type === "entry" && write.value.model?.some((message) => message.role === "assistant") ||
        write.type === "submission" && (write.value.status === "done" || write.value.status === "unanswered"))
      if (boundary || this.pendingBytes > BATCH_BYTES) this.flush()
      this.observeIds(prepared.writes, prepared.seq)
      return seq
    })
  }

  override mintId<I extends Id<string>>(): Promise<I> {
    return this.serial(async () => {
      if (this.finished) throw new Error("Storage is closed")
      if (this.ids.next >= this.ids.end) {
        this.durable.transactionSync(() => {
          const persisted = this.durable.sql.exec<{ next_id: number }>("SELECT next_id FROM journal_ids WHERE agent = ?", this.key).toArray()[0]?.next_id ?? 2
          const start = Math.max(this.ids.next, persisted)
          if (!Number.isSafeInteger(start)) throw new Error("ID space is exhausted")
          const end = Math.min(start + ID_RANGE, Number.MAX_SAFE_INTEGER + 1)
          this.durable.sql.exec("INSERT INTO journal_ids (agent, next_id) VALUES (?, ?) ON CONFLICT(agent) DO UPDATE SET next_id = excluded.next_id", this.key, end)
          this.ids.next = start
          this.ids.end = end
        })
      }
      const value = this.ids.next++
      return value as I
    })
  }

  override close(context: Context): Promise<void> {
    return this.serial(async () => {
      this.flush()
      await super.close(context)
      this.finished = true
    })
  }

  // Synchronous so a tool boundary checkpoints before its outside work starts.
  flush(): void {
    const last = this.pending.at(-1)
    if (!last) return
    this.append({ seq: last.seq, commits: this.pending })
    this.pending = []
    this.pendingBytes = 0
  }

  settlement(id: SubmissionId): Seq | undefined { return this.settlements.get(id) }

  private observeIds(writes: readonly StorageWrite[], seq: Seq): void {
    for (const write of writes) {
      if (write.type === "entry" && write.value.kind === "kiko.input") {
        const data = write.value.data
        if (data && typeof data === "object" && !Array.isArray(data) && typeof data.humanDeliveredSeq === "number" && Number.isSafeInteger(data.humanDeliveredSeq) && data.humanDeliveredSeq >= this.humanDeliveredSeq) {
          this.humanDeliveredSeq = data.humanDeliveredSeq
          this.input = write.value
        }
      }
      if (write.type === "submission" && write.value.type === "input" && this.input && write.value.entry === this.input.id) {
        this.checkpoint = { entry: this.input, submission: write.value, seq }
      }
      if (write.type === "submission" && (write.value.status === "done" || write.value.status === "unanswered")) this.settlements.set(write.value.id, seq)
      const id = write.type === "document.create" || write.type === "document.copy" ? write.record.id
        : write.type === "document.change" || write.type === "document.retire" ? write.id : write.value.id
      this.ids.next = Math.max(this.ids.next, id + 1)
    }
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation)
    this.tail = result.catch(() => {})
    return result
  }

  private append(envelope: Batch): void {
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
