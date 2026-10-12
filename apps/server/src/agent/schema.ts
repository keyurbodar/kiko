import type { Step } from "@yuki/durable/migrate"
import { HOST_STEPS } from "@yuki/agent/host"

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
]
