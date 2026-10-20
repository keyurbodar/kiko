import { ownerStorage } from "../owner/context"
import type { RoomLog } from "../room/log"
import { searchMessages, type SearchOptions } from "../room/search"
import { type ArchivedMessage, type HistoryStore, type PendingArchive } from "./history-archive"

/**
 * Archive state and pending rows live in the scoped storage passed in. Shared message reads go through
 * the owner storage and this room's id, so one room never reads or archives another room's rows.
 */
export class RoomHistoryStore implements HistoryStore {
  private readonly shared: DurableObjectStorage

  constructor(private readonly storage: DurableObjectStorage, private readonly log: RoomLog) {
    this.shared = ownerStorage(storage)
  }

  state(): { writtenDay: string | null; pending: PendingArchive | null } {
    const row = this.storage.sql.exec<{ written_day: string | null; pending: string | null }>("SELECT written_day, pending FROM history_archive_state WHERE id = 1").toArray()[0]
    return { writtenDay: row?.written_day ?? null, pending: row?.pending ? { day: row.pending, rows: this.readPending("rows"), snapshot: this.readPending("snapshot") } : null }
  }

  oldestDay(before: number): string | null {
    const at = this.shared.sql.exec<{ at: number | null }>("SELECT min(at) AS at FROM messages WHERE room_id = ? AND at < ?", this.log.roomId, before).one().at
    return at === null ? null : new Date(at).toISOString().slice(0, 10)
  }

  snapshot(day: string) { return this.log.archiveSnapshot(day) }
  overrides(ids: string[]) { return this.log.archiveOverrides(ids) }
  around(seq: number, before: number, after: number) { return this.log.around(seq, before, after) }
  search(query: string, options: SearchOptions) { return searchMessages(this.shared.sql, this.log.roomId, query, options) }

  private readPending(kind: string): ArchivedMessage[] {
    const result: ArchivedMessage[] = []
    let rest = ""
    for (const row of this.storage.sql.exec<{ payload: string }>("SELECT payload FROM history_archive_pending WHERE kind = ? ORDER BY n", kind)) {
      const lines = (rest + row.payload).split("\n")
      rest = lines.pop() ?? ""
      for (const line of lines) result.push(JSON.parse(line) as ArchivedMessage)
    }
    if (rest) throw new Error("Incomplete pending archive")
    return result
  }

  prepare(pending: PendingArchive): void {
    this.storage.transactionSync(() => {
      this.storage.sql.exec("DELETE FROM history_archive_pending")
      for (const kind of ["rows", "snapshot"] as const) {
        let chunk = ""
        let n = 0
        for (const row of pending[kind]) {
          chunk += JSON.stringify(row) + "\n"
          while (chunk.length >= 250_000) {
            const edge = /[\uD800-\uDBFF]/.test(chunk[249_999]!) ? 249_999 : 250_000
            this.storage.sql.exec("INSERT INTO history_archive_pending (kind, n, payload) VALUES (?, ?, ?)", kind, n++, chunk.slice(0, edge))
            chunk = chunk.slice(edge)
          }
        }
        if (chunk) this.storage.sql.exec("INSERT INTO history_archive_pending (kind, n, payload) VALUES (?, ?, ?)", kind, n, chunk)
      }
      this.storage.sql.exec("INSERT INTO history_archive_state (id, pending) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET pending = excluded.pending", pending.day)
    })
  }

  finish(pending: PendingArchive, writtenDay: string): void {
    this.storage.transactionSync(() => {
      this.log.deleteArchived(pending.snapshot)
      this.storage.sql.exec("DELETE FROM history_archive_pending")
      this.storage.sql.exec("UPDATE history_archive_state SET pending = NULL, written_day = ? WHERE id = 1", writtenDay)
    })
  }
}
