import type { AgentSlug, RoomId } from "@kiko/protocol"


export type AskState = { state: "open" | "answered" | "closed"; answer: string | null }

export type Unanswered = { id: string; asker: AgentSlug; state: "open" | "closed"; remote: RoomId | null }

export type RemoteAsk = { asker: AgentSlug; state: "open" | "answered" | "closed"; answer: string | null }

export const KEEP_ASKS_MS = 7 * 86_400_000

export class Asks {
  constructor(private readonly sql: SqlStorage) {
  }

  open(id: string, asker: AgentSlug, askee: AgentSlug, now: number): void {
    this.sql.exec("INSERT OR IGNORE INTO agent_asks (id, asker, askee, at, state) VALUES (?, ?, ?, ?, 'open')", id, asker, askee, now)
    if (Math.random() < 0.02) this.sql.exec("DELETE FROM agent_asks WHERE at < ?", now - KEEP_ASKS_MS)
  }

  sent(id: string, messageId: string, remote: RoomId | null = null): void {
    this.sql.exec("UPDATE agent_asks SET message_id = ?, remote = coalesce(?, remote) WHERE id = ?", messageId, remote, id)
  }

  waiting(asker: AgentSlug, askee: AgentSlug): boolean {
    return this.sql.exec("SELECT 1 FROM agent_asks WHERE asker = ? AND askee = ? AND state = 'open' LIMIT 1", asker, askee).toArray().length > 0
  }

  /** A send_message expects an answer but waits for none, so its row is closed from the start. */
  expect(id: string, asker: AgentSlug, askee: AgentSlug, messageId: string, now: number, remote: RoomId | null = null): void {
    this.sql.exec("INSERT OR IGNORE INTO agent_asks (id, asker, askee, at, state, message_id, remote) VALUES (?, ?, ?, ?, 'closed', ?, ?)", id, asker, askee, now, messageId, remote)
  }

  /** A send from `from` to `to` answers what `to` expects of `from`. `answered` is true when it settled any row, open or closed. `open` is the waiting ask it answered, if any. */
  answer(from: AgentSlug, to: AgentSlug, text: string, sendId: string): { answered: boolean; open: string | null } {
    const open = this.sql.exec<{ id: string }>("SELECT id FROM agent_asks WHERE asker = ? AND askee = ? AND state = 'open' AND remote IS NULL ORDER BY at LIMIT 1", to, from).toArray()[0]
    const closed = this.sql.exec("UPDATE agent_asks SET answer = ? WHERE asker = ? AND askee = ? AND state = 'closed' AND answer IS NULL AND remote IS NULL", text, to, from).rowsWritten > 0
    if (!open) return { answered: closed, open: null }
    this.sql.exec("UPDATE agent_asks SET state = 'answered', answer = ?, answer_send = ? WHERE id = ?", text, sendId, open.id)
    return { answered: true, open: open.id }
  }

  /** In a pair room, a send from `from` to `to` answers what `to` asked of `from` in another room. Returns the rows it settled, so their answers go back there. */
  answerRemote(from: AgentSlug, to: AgentSlug, text: string): { id: string; remote: RoomId }[] {
    const rows = this.sql
      .exec<{ id: string; remote: RoomId }>("SELECT id, remote FROM agent_asks WHERE asker = ? AND askee = ? AND state = 'closed' AND answer IS NULL AND remote IS NOT NULL ORDER BY at", to, from)
      .toArray()
    for (const row of rows) this.sql.exec("UPDATE agent_asks SET answer = ? WHERE id = ?", text, row.id)
    return rows
  }

  /** The ask a private talk opened here, which the answer from the pair room settles. */
  remote(id: string): RemoteAsk | null {
    return this.sql.exec<RemoteAsk>("SELECT asker, state, answer FROM agent_asks WHERE id = ? AND remote IS NOT NULL", id).toArray()[0] ?? null
  }

  answeredBy(sendId: string): string | null {
    return this.sql.exec<{ id: string }>("SELECT id FROM agent_asks WHERE answer_send = ?", sendId).toArray()[0]?.id ?? null
  }

  unanswered(askee: AgentSlug, messageIds: readonly string[]): Unanswered[] {
    if (!messageIds.length) return []
    return this.sql
      .exec<Unanswered>(
        "SELECT id, asker, state, remote FROM agent_asks WHERE askee = ? AND answer IS NULL AND state != 'answered' AND message_id IN (SELECT value FROM json_each(?)) ORDER BY at",
        askee,
        JSON.stringify(messageIds),
      )
      .toArray()
  }

  settle(id: string, text: string): boolean {
    return (
      this.sql.exec("UPDATE agent_asks SET state = CASE state WHEN 'open' THEN 'answered' ELSE state END, answer = ? WHERE id = ? AND answer IS NULL", text, id).rowsWritten > 0
    )
  }

  get(id: string): AskState | null {
    return this.sql.exec<AskState>("SELECT state, answer FROM agent_asks WHERE id = ?", id).toArray()[0] ?? null
  }

  close(id: string): AskState | null {
    this.sql.exec("UPDATE agent_asks SET state = 'closed' WHERE id = ? AND state = 'open'", id)
    return this.get(id)
  }
}
