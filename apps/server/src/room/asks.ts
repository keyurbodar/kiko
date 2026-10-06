import type { AgentSlug } from "@kiko/protocol"

// Architecture section 7.5. An agent can ask a teammate and wait for the answer inside its own run,
// instead of ending the run and waking again when the reply arrives. The question goes out like any
// agent message. While it is open, the teammate's next `send_message` back to the asker is its answer:
// the room stores it in the chat as usual but does not deliver it, and pushes it to the asking tool.
// An ask that times out is closed, and a later reply is delivered like any other message.

/** `tainted`: the answer came from a run that read outside content, so it taints the asker's run. */
export type AskState = { state: "open" | "answered" | "closed"; answer: string | null; tainted: boolean }

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
    if (!sql.exec<{ name: string }>("PRAGMA table_info(agent_asks)").toArray().some((c) => c.name === "tainted")) {
      sql.exec("ALTER TABLE agent_asks ADD COLUMN tainted INTEGER NOT NULL DEFAULT 0")
    }
  }

  /** Opens the ask. A repeat of the same id (a replayed tool call) changes nothing. */
  open(id: string, asker: AgentSlug, askee: AgentSlug, now: number): void {
    this.sql.exec("INSERT OR IGNORE INTO agent_asks (id, asker, askee, at, state) VALUES (?, ?, ?, ?, 'open')", id, asker, askee, now)
  }

  /** `from`'s message to `to` answers `to`'s oldest open ask of `from`. Returns that ask's id, or null. */
  answer(from: AgentSlug, to: AgentSlug, text: string, tainted: boolean): string | null {
    const open = this.sql.exec<{ id: string }>("SELECT id FROM agent_asks WHERE asker = ? AND askee = ? AND state = 'open' ORDER BY at LIMIT 1", to, from).toArray()[0]
    if (!open) return null
    this.sql.exec("UPDATE agent_asks SET state = 'answered', answer = ?, tainted = ? WHERE id = ?", text, tainted ? 1 : 0, open.id)
    return open.id
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
