import type { AgentSlug } from "@yuki/protocol"

// Architecture section 7.5. An agent can ask a teammate and wait for the answer inside its own run,
// instead of ending the run and waking again when the reply arrives. The question goes out like any
// agent message. While it is open, the teammate's next `send_message` back to the asker is its answer:
// the room stores it in the chat as usual but does not deliver it, and pushes it to the asking tool.
// A teammate that answers in a plain reply instead answers too: when the run that read the question
// ends with no `send_message` to the asker, its bubbles are the answer (`RoomDO.endRun`). An ask that
// times out is closed, and a later reply is delivered like any other message. `answer` is set once
// anything answered the ask, so nothing answers it twice.

/** `tainted`: the answer came from a run that read outside content, so it taints the asker's run. */
export type AskState = { state: "open" | "answered" | "closed"; answer: string | null; tainted: boolean }

/** An ask still waiting for its first answer: open, or closed by a wait that ran out. */
export type Unanswered = { id: string; asker: AgentSlug; state: "open" | "closed" }

/** Asks older than this are dropped. A wait lasts two minutes; a week is far past any replay. */
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
    // The question's message id, so the run that read it is known, and the send that answered it, so a replay finds it.
    const columns = new Set(sql.exec<{ name: string }>("PRAGMA table_info(agent_asks)").toArray().map((c) => c.name))
    if (!columns.has("message_id")) sql.exec("ALTER TABLE agent_asks ADD COLUMN message_id TEXT")
    if (!columns.has("answer_send")) sql.exec("ALTER TABLE agent_asks ADD COLUMN answer_send TEXT")
    if (!sql.exec<{ name: string }>("PRAGMA table_info(agent_asks)").toArray().some((c) => c.name === "tainted")) {
      sql.exec("ALTER TABLE agent_asks ADD COLUMN tainted INTEGER NOT NULL DEFAULT 0")
    }
  }

  /** Opens the ask. A repeat of the same id (a replayed tool call) changes nothing. */
  open(id: string, asker: AgentSlug, askee: AgentSlug, now: number): void {
    this.sql.exec("INSERT OR IGNORE INTO agent_asks (id, asker, askee, at, state) VALUES (?, ?, ?, ?, 'open')", id, asker, askee, now)
    if (Math.random() < 0.02) this.sql.exec("DELETE FROM agent_asks WHERE at < ?", now - KEEP_ASKS_MS)
  }

  /** The question went out as message `messageId`. */
  sent(id: string, messageId: string): void {
    this.sql.exec("UPDATE agent_asks SET message_id = ? WHERE id = ?", messageId, id)
  }

  /** True while `asker` waits on its open ask of `askee`. */
  waiting(asker: AgentSlug, askee: AgentSlug): boolean {
    return this.sql.exec("SELECT 1 FROM agent_asks WHERE asker = ? AND askee = ? AND state = 'open' LIMIT 1", asker, askee).toArray().length > 0
  }

  /**
   * `from`'s message to `to`, send `sendId`, answers `to`'s oldest open ask of `from`. Returns that ask's
   * id, or null. An ask whose wait ran out takes the message as its answer too, so a plain reply later
   * never answers it a second time; the message is then delivered as ordinary mail.
   */
  answer(from: AgentSlug, to: AgentSlug, text: string, sendId: string, tainted: boolean): string | null {
    const open = this.sql.exec<{ id: string }>("SELECT id FROM agent_asks WHERE asker = ? AND askee = ? AND state = 'open' ORDER BY at LIMIT 1", to, from).toArray()[0]
    this.sql.exec("UPDATE agent_asks SET answer = ? WHERE asker = ? AND askee = ? AND state = 'closed' AND answer IS NULL", text, to, from)
    if (!open) return null
    this.sql.exec("UPDATE agent_asks SET state = 'answered', answer = ?, answer_send = ?, tainted = ? WHERE id = ?", text, sendId, tainted ? 1 : 0, open.id)
    return open.id
  }

  /** The ask that send `sendId` answered, for a replayed send. */
  answeredBy(sendId: string): string | null {
    return this.sql.exec<{ id: string }>("SELECT id FROM agent_asks WHERE answer_send = ?", sendId).toArray()[0]?.id ?? null
  }

  /** The asks of questions `messageIds` to `askee` that nothing answered yet, oldest first. */
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

  /** Answers ask `id` with `text`. An open ask becomes answered; a closed one keeps its state. False when it had an answer. */
  settle(id: string, text: string, tainted: boolean): boolean {
    return (
      this.sql.exec("UPDATE agent_asks SET state = CASE state WHEN 'open' THEN 'answered' ELSE state END, answer = ?, tainted = ? WHERE id = ? AND answer IS NULL", text, tainted ? 1 : 0, id).rowsWritten > 0
    )
  }

  get(id: string): AskState | null {
    const row = this.sql.exec<{ state: AskState["state"]; answer: string | null; tainted: number }>("SELECT state, answer, tainted FROM agent_asks WHERE id = ?", id).toArray()[0]
    return row ? { state: row.state, answer: row.answer, tainted: row.tainted === 1 } : null
  }

  /** The asker stopped waiting. An answer that already arrived is kept and returned. */
  close(id: string): AskState | null {
    this.sql.exec("UPDATE agent_asks SET state = 'closed' WHERE id = ? AND state = 'open'", id)
    return this.get(id)
  }
}
