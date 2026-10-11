import type { AgentSlug } from "@yuki/protocol"


export type AskState = { state: "open" | "answered" | "closed"; answer: string | null }

export type Unanswered = { id: string; asker: AgentSlug; state: "open" | "closed" }

export const KEEP_ASKS_MS = 7 * 86_400_000

export class Asks {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS agent_asks (
      id TEXT PRIMARY KEY,
      asker TEXT NOT NULL,
      askee TEXT NOT NULL,
      at INTEGER NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('open', 'answered', 'closed')),
      answer TEXT
    ) STRICT`)
    const columns = new Set(sql.exec<{ name: string }>("PRAGMA table_info(agent_asks)").toArray().map((c) => c.name))
    if (!columns.has("message_id")) sql.exec("ALTER TABLE agent_asks ADD COLUMN message_id TEXT")
    if (!columns.has("answer_send")) sql.exec("ALTER TABLE agent_asks ADD COLUMN answer_send TEXT")
  }

  open(id: string, asker: AgentSlug, askee: AgentSlug, now: number): void {
    this.sql.exec("INSERT OR IGNORE INTO agent_asks (id, asker, askee, at, state) VALUES (?, ?, ?, ?, 'open')", id, asker, askee, now)
    if (Math.random() < 0.02) this.sql.exec("DELETE FROM agent_asks WHERE at < ?", now - KEEP_ASKS_MS)
  }

  sent(id: string, messageId: string): void {
    this.sql.exec("UPDATE agent_asks SET message_id = ? WHERE id = ?", messageId, id)
  }

  waiting(asker: AgentSlug, askee: AgentSlug): boolean {
    return this.sql.exec("SELECT 1 FROM agent_asks WHERE asker = ? AND askee = ? AND state = 'open' LIMIT 1", asker, askee).toArray().length > 0
  }

  answer(from: AgentSlug, to: AgentSlug, text: string, sendId: string): string | null {
    const open = this.sql.exec<{ id: string }>("SELECT id FROM agent_asks WHERE asker = ? AND askee = ? AND state = 'open' ORDER BY at LIMIT 1", to, from).toArray()[0]
    this.sql.exec("UPDATE agent_asks SET answer = ? WHERE asker = ? AND askee = ? AND state = 'closed' AND answer IS NULL", text, to, from)
    if (!open) return null
    this.sql.exec("UPDATE agent_asks SET state = 'answered', answer = ?, answer_send = ? WHERE id = ?", text, sendId, open.id)
    return open.id
  }

  answeredBy(sendId: string): string | null {
    return this.sql.exec<{ id: string }>("SELECT id FROM agent_asks WHERE answer_send = ?", sendId).toArray()[0]?.id ?? null
  }

  unanswered(askee: AgentSlug, messageIds: readonly string[]): Unanswered[] {
    if (!messageIds.length) return []
    return this.sql
      .exec<Unanswered>(
        "SELECT id, asker, state FROM agent_asks WHERE askee = ? AND answer IS NULL AND state != 'answered' AND message_id IN (SELECT value FROM json_each(?)) ORDER BY at",
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
