import type { JsonValue } from "@earendil-works/chord"
import type { Step } from "@kiko/durable/migrate"
import { JournalCorrupt } from "./errors"

export const ROLLOVER_STEPS: Step[] = [
  "CREATE TABLE IF NOT EXISTS agent_handoff (agent TEXT PRIMARY KEY, input TEXT NOT NULL) WITHOUT ROWID, STRICT",
]

export function rollover(
  storage: DurableObjectStorage,
  agent: string,
  input: readonly JsonValue[],
  reset: () => void,
): void {
  storage.transactionSync(() => {
    storage.sql.exec(
      "INSERT INTO agent_handoff(agent, input) VALUES (?, ?) ON CONFLICT(agent) DO UPDATE SET input = excluded.input",
      agent,
      JSON.stringify(input),
    )
    reset()
  })
}

export async function restoreRollover(
  storage: DurableObjectStorage,
  agent: string,
  restore: (input: readonly JsonValue[]) => Promise<void>,
): Promise<void> {
  const row = storage.sql.exec<{ input: string }>("SELECT input FROM agent_handoff WHERE agent = ?", agent).toArray()[0]
  if (!row) return
  const input: unknown = JSON.parse(row.input)
  if (!Array.isArray(input)) throw new JournalCorrupt({ reason: "handoff", message: "Invalid agent task handoff" })
  await restore(input)
  storage.sql.exec("DELETE FROM agent_handoff WHERE agent = ? AND input = ?", agent, row.input)
}
