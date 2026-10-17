import type { AgentSlug, RoomId } from "@kiko/protocol"

/**
 * A message that expects an answer. A `send_message` opens one per recipient, and a talk between
 * two agents in a pair room carries one back to the room that asked. Nothing waits on it: the
 * answer arrives as a new delivery, and this row is what the room uses to relay it once.
 */
export type Unanswered = { id: string; asker: AgentSlug; state: "open" | "closed"; remote: RoomId | null }

type RemoteAsk = { asker: AgentSlug; state: "open" | "closed"; answer: string | null }

export const KEEP_ASKS_MS = 7 * 86_400_000

export class Asks {
  constructor(private readonly sql: SqlStorage) {
  }

  /** A message that expects an answer but waits for none, so its row is closed from the start. */
  expect(id: string, asker: AgentSlug, askee: AgentSlug, messageId: string, now: number, remote: RoomId | null = null): void {
    this.sql.exec("INSERT OR IGNORE INTO agent_asks (id, asker, askee, at, state, message_id, remote) VALUES (?, ?, ?, ?, 'closed', ?, ?)", id, asker, askee, now, messageId, remote)
    if (Math.random() < 0.02) this.sql.exec("DELETE FROM agent_asks WHERE at < ?", now - KEEP_ASKS_MS)
  }

  /** A send from `from` to `to` answers what `to` expects of `from`, once. */
  answer(from: AgentSlug, to: AgentSlug, text: string): boolean {
    return this.sql.exec("UPDATE agent_asks SET answer = ? WHERE asker = ? AND askee = ? AND state = 'closed' AND answer IS NULL AND remote IS NULL", text, to, from).rowsWritten > 0
  }

  /** In a pair room, a send from `from` to `to` answers what `to` asked of `from` in another room. Returns the rows it settled, so their answers go back there. */
  answerRemote(from: AgentSlug, to: AgentSlug, text: string): { id: string; remote: RoomId }[] {
    const rows = this.sql
      .exec<{ id: string; remote: RoomId }>("SELECT id, remote FROM agent_asks WHERE asker = ? AND askee = ? AND state = 'closed' AND answer IS NULL AND remote IS NOT NULL ORDER BY at", to, from)
      .toArray()
    for (const row of rows) this.sql.exec("UPDATE agent_asks SET answer = ? WHERE id = ?", text, row.id)
    return rows
  }

  /** The expectation a private talk opened here, which the answer from the pair room settles. */
  remote(id: string): RemoteAsk | null {
    return this.sql.exec<RemoteAsk>("SELECT asker, state, answer FROM agent_asks WHERE id = ? AND remote IS NOT NULL", id).toArray()[0] ?? null
  }

  /** One expectation, wherever it goes. */
  get(id: string): RemoteAsk | null {
    return this.sql.exec<RemoteAsk>("SELECT asker, state, answer FROM agent_asks WHERE id = ?", id).toArray()[0] ?? null
  }

  unanswered(askee: AgentSlug, messageIds: readonly string[]): Unanswered[] {
    if (!messageIds.length) return []
    return this.sql
      .exec<Unanswered>(
        "SELECT id, asker, state, remote FROM agent_asks WHERE askee = ? AND answer IS NULL AND message_id IN (SELECT value FROM json_each(?)) ORDER BY at",
        askee,
        JSON.stringify(messageIds),
      )
      .toArray()
  }

  settle(id: string, text: string): boolean {
    return this.sql.exec("UPDATE agent_asks SET answer = ? WHERE id = ? AND answer IS NULL", text, id).rowsWritten > 0
  }
}
