import type { Step } from "@kiko/durable/migrate"
import { HOST_STEPS, HOST_TAIL } from "@kiko/agent/host"

// The agent's tables, in one list. An object at version N runs only the steps after the first N. A step is
// appended, never edited or moved, and every step must be safe on a table that already exists.
export const AGENT_STEPS: Step[] = [
  "CREATE TABLE IF NOT EXISTS agent_home (id INTEGER PRIMARY KEY CHECK (id = 1), home TEXT NOT NULL)",
  `CREATE TABLE IF NOT EXISTS outbox (
    run_id TEXT PRIMARY KEY,
    attempt INTEGER NOT NULL,
    cursor INTEGER NOT NULL,
    blocks TEXT NOT NULL,
    posted INTEGER NOT NULL,
    ended INTEGER NOT NULL DEFAULT 0
  ) STRICT`,
  ...HOST_STEPS,
  // The inbox's reads by request and by age scanned every row the inbox kept, seven days of history. The outbox read every run it ever ended.
  "CREATE INDEX IF NOT EXISTS inbox_by_request ON inbox (request_id, priority, arrival)",
  "CREATE INDEX IF NOT EXISTS inbox_by_submitted_at ON inbox (submitted, at)",
  "CREATE INDEX IF NOT EXISTS outbox_by_ended ON outbox (ended)",
  // An ended run now deletes its row. This clears the ones the old code kept.
  "DELETE FROM outbox WHERE ended = 1",
  ...HOST_TAIL,
]
