import type { Step } from "@kiko/durable/migrate"
import { JOURNAL_STEPS } from "@kiko/agent/journal"
import { INITIAL_HOST_STEPS } from "@kiko/agent/host"

export const INITIAL_AGENT_STEPS: Step[] = [
  ...INITIAL_HOST_STEPS,
  ...JOURNAL_STEPS,
  `CREATE TABLE IF NOT EXISTS outbox (
    agent TEXT NOT NULL, run_id TEXT NOT NULL, attempt INTEGER NOT NULL,
    cursor INTEGER NOT NULL, blocks TEXT NOT NULL, posted INTEGER NOT NULL, failure TEXT,
    PRIMARY KEY (agent, run_id)
  ) WITHOUT ROWID, STRICT`,
]
