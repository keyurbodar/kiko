import type { RoomLog } from "../room/log"
import { searchMessages, type SearchOptions } from "../room/search"
import { HistoryError } from "./errors"
import type { ArchivedMessage, HistoryStore, PendingArchive } from "./history-archive"

export class RoomHistoryStore implements HistoryStore {
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly log: RoomLog,
    private readonly capture: () => void,
  ) {}

  state(): { writtenDay: string | null; pending: PendingArchive | null } {
    const row = this.storage.sql
      .exec<{ written_day: string | null; pending: string | null }>(
        "SELECT written_day, pending FROM history_archive_state WHERE room_id = ?",
        this.log.roomId,
      )
      .toArray()[0]
    return {
      writtenDay: row?.written_day ?? null,
      pending: row?.pending
        ? { day: row.pending, rows: this.readPending("rows"), snapshot: this.readPending("snapshot") }
        : null,
    }
  }

  oldestDay(before: number): string | null {
    const at = this.storage.sql
      .exec<{ at: number }>(
        "SELECT at FROM messages WHERE room_id = ? AND at < ? ORDER BY at LIMIT 1",
        this.log.roomId,
        before,
      )
      .toArray()[0]?.at
    return at === undefined ? null : new Date(at).toISOString().slice(0, 10)
  }

  snapshot(day: string) {
    this.capture()
    return this.log.archiveSnapshot(day)
  }
  overrides(ids: string[]) {
    return this.log.archiveOverrides(ids)
  }
  around(seq: number, before: number, after: number) {
    return this.log.around(seq, before, after)
  }
  search(query: string, options: SearchOptions) {
    return searchMessages(this.storage, this.log.roomId, query, options)
  }

  hydrate(row: ArchivedMessage): void {
    const message = row.message
    if (!message) return
    this.storage.transactionSync(() => {
      const json = (value: unknown) => (value === undefined ? null : JSON.stringify(value))
      const inserted = this.storage.sql
        .exec(
          `INSERT OR IGNORE INTO messages (room_id, seq, id, at, sender, text, rich, reply_to, files, run_id, run_attempt, run_index, edited_at, goto, quote, addressed, initiative, event, steps, step_after)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
          this.log.roomId,
          message.seq,
          message.id,
          message.at,
          json(message.from),
          message.text,
          json(message.rich),
          message.replyTo ?? null,
          json(message.files),
          message.run?.runId ?? null,
          message.run?.attempt ?? null,
          message.run?.index ?? null,
          message.editedAt ?? null,
          message.goto ?? null,
          message.quote ?? null,
          message.to ?? null,
          message.initiative?.reason ?? null,
          json(message.event),
          message.steps ?? null,
          message.stepAfter ?? null,
        )
        .toArray()
      if (!inserted.length) return
      this.storage.sql.exec("DELETE FROM archived_unread WHERE room_id = ? AND seq = ?", this.log.roomId, message.seq)
      for (const reaction of message.reactions ?? []) {
        const actor = reaction.by.kind === "human" ? "human" : `agent:${reaction.by.slug}`
        this.storage.sql.exec(
          "INSERT INTO reactions (room_id, message_id, actor, emoji, at) VALUES (?, ?, ?, ?, ?)",
          this.log.roomId,
          message.id,
          actor,
          reaction.emoji,
          message.at,
        )
      }
    })
  }

  private readPending(kind: string): ArchivedMessage[] {
    const result: ArchivedMessage[] = []
    let rest = ""
    for (const row of this.storage.sql.exec<{ payload: string }>(
      "SELECT payload FROM history_archive_pending WHERE room_id = ? AND kind = ? ORDER BY n",
      this.log.roomId,
      kind,
    )) {
      const lines = (rest + row.payload).split("\n")
      rest = lines.pop() ?? ""
      for (const line of lines) result.push(JSON.parse(line) as ArchivedMessage)
    }
    if (rest) throw new HistoryError({ kind: "incomplete", message: "Incomplete pending archive" })
    return result
  }

  prepare(pending: PendingArchive): void {
    this.storage.transactionSync(() => {
      this.storage.sql.exec("DELETE FROM history_archive_pending WHERE room_id = ?", this.log.roomId)
      for (const kind of ["rows", "snapshot"] as const) {
        let chunk = ""
        let n = 0
        for (const row of pending[kind]) {
          chunk += JSON.stringify(row) + "\n"
          while (chunk.length >= 250_000) {
            const edge = /[\uD800-\uDBFF]/.test(chunk[249_999]!) ? 249_999 : 250_000
            this.storage.sql.exec(
              "INSERT INTO history_archive_pending (room_id, kind, n, payload) VALUES (?, ?, ?, ?)",
              this.log.roomId,
              kind,
              n++,
              chunk.slice(0, edge),
            )
            chunk = chunk.slice(edge)
          }
        }
        if (chunk)
          this.storage.sql.exec(
            "INSERT INTO history_archive_pending (room_id, kind, n, payload) VALUES (?, ?, ?, ?)",
            this.log.roomId,
            kind,
            n,
            chunk,
          )
      }
      this.storage.sql.exec(
        "INSERT INTO history_archive_state (room_id, pending) VALUES (?, ?) ON CONFLICT(room_id) DO UPDATE SET pending = excluded.pending",
        this.log.roomId,
        pending.day,
      )
    })
  }

  finish(pending: PendingArchive, writtenDay: string): void {
    this.storage.transactionSync(() => {
      this.log.deleteArchived(pending.snapshot)
      this.storage.sql.exec("DELETE FROM history_archive_pending WHERE room_id = ?", this.log.roomId)
      this.storage.sql.exec(
        "UPDATE history_archive_state SET pending = NULL, written_day = ? WHERE room_id = ?",
        writtenDay,
        this.log.roomId,
      )
    })
  }
}
