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
  constructor(private readonly sql: SqlStorage, private readonly roomId: string) {
  }

  /** A message that expects an answer but waits for none, so its row is closed from the start. */
  expect(id: string, asker: AgentSlug, askee: AgentSlug, messageId: string, now: number, remote: RoomId | null = null): void {
    this.sql.exec("INSERT OR IGNORE INTO agent_asks (id, asker, askee, at, state, message_id, remote, room_id) VALUES (?1, ?2, ?3, ?4, 'closed', ?5, ?6, ?7)", id, asker, askee, now, messageId, remote, this.roomId)
    if (Math.random() < 0.02) this.sql.exec("DELETE FROM agent_asks WHERE at < ?1 AND agent_asks.room_id = ?2", now - KEEP_ASKS_MS, this.roomId)
  }

  /** A send from `from` to `to` answers what `to` expects of `from`, once. */
  answer(from: AgentSlug, to: AgentSlug, text: string): boolean {
    return this.sql.exec("UPDATE agent_asks SET answer = ?1 WHERE (asker = ?2 AND askee = ?3 AND state = 'closed' AND answer IS NULL AND remote IS NULL) AND agent_asks.room_id = ?4", text, to, from, this.roomId).rowsWritten > 0
  }

  /** In a pair room, a send from `from` to `to` answers what `to` asked of `from` in another room. Returns the rows it settled, so their answers go back there. */
  answerRemote(from: AgentSlug, to: AgentSlug, text: string): { id: string; remote: RoomId }[] {
    const rows = this.sql
      .exec<{ id: string; remote: RoomId }>("SELECT id, remote FROM agent_asks WHERE (asker = ?1 AND askee = ?2 AND state = 'closed' AND answer IS NULL AND NOT remote IS NULL) AND agent_asks.room_id = ?3 ORDER BY at", to, from, this.roomId)
      .toArray()
    for (const row of rows) this.sql.exec("UPDATE agent_asks SET answer = ?1 WHERE id = ?2 AND agent_asks.room_id = ?3", text, row.id, this.roomId)
    return rows
  }

  /** The expectation a private talk opened here, which the answer from the pair room settles. */
  remote(id: string): RemoteAsk | null {
    return this.sql.exec<RemoteAsk>("SELECT asker, state, answer FROM agent_asks WHERE (id = ?1 AND NOT remote IS NULL) AND agent_asks.room_id = ?2", id, this.roomId).toArray()[0] ?? null
  }

  /** One expectation, wherever it goes. */
  get(id: string): RemoteAsk | null {
    return this.sql.exec<RemoteAsk>("SELECT asker, state, answer FROM agent_asks WHERE id = ?1 AND agent_asks.room_id = ?2", id, this.roomId).toArray()[0] ?? null
  }

  unanswered(askee: AgentSlug, messageIds: readonly string[]): Unanswered[] {
    if (!messageIds.length) return []
    return this.sql
      .exec<Unanswered>(
        "SELECT id, asker, state, remote FROM agent_asks WHERE (askee = ?1 AND answer IS NULL AND message_id IN (SELECT value FROM JSON_EACH(?2))) AND agent_asks.room_id = ?3 ORDER BY at",
        askee,
        JSON.stringify(messageIds), this.roomId,
      )
      .toArray()
  }

  settle(id: string, text: string): boolean {
    return this.sql.exec("UPDATE agent_asks SET answer = ?1 WHERE (id = ?2 AND answer IS NULL) AND agent_asks.room_id = ?3", text, id, this.roomId).rowsWritten > 0
  }
}
