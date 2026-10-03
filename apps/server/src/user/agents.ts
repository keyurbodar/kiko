import type { Agent, AgentSlug } from "@kiko/protocol"

// The user's agents. One row each, created once. A repeat of the same id changes
// nothing, so a client that resends after a reconnect is safe. A slug another agent
// already holds is refused, because the handle is how the user addresses it.

const MAX_NAME = 60
// The description seeds the agent's soul (souls.ts), which holds 3,000 characters.
const MAX_PROMPT = 2_500
const MAX_MODEL = 200
const MAX_AGENTS = 200

type Row = { id: string; name: string; slug: string; prompt: string; model: string }

const toAgent = (row: Row): Agent => ({ id: row.id, name: row.name, slug: row.slug as AgentSlug, prompt: row.prompt, model: row.model })

export function listAgents(sql: SqlStorage): Agent[] {
  return sql.exec<Row>("SELECT id, name, slug, prompt, model FROM agents ORDER BY created_at, id").toArray().map(toAgent)
}

/** The stored agent, or null when the input is refused. A repeat returns null too: nothing changed. */
export function createAgent(sql: SqlStorage, agent: Agent, now: number): Agent | null {
  const name = agent.name.trim().slice(0, MAX_NAME)
  if (!name || !/^[a-z0-9-]{1,32}$/.test(agent.slug)) return null
  if (sql.exec("SELECT 1 FROM agents WHERE id = ? OR slug = ?", agent.id, agent.slug).toArray().length) return null
  if (sql.exec<{ n: number }>("SELECT count(*) AS n FROM agents").one().n >= MAX_AGENTS) return null
  const row: Row = { id: agent.id, name, slug: agent.slug, prompt: agent.prompt.trim().slice(0, MAX_PROMPT), model: agent.model.slice(0, MAX_MODEL) }
  sql.exec("INSERT INTO agents (id, name, slug, prompt, model, created_at) VALUES (?, ?, ?, ?, ?, ?)", row.id, row.name, row.slug, row.prompt, row.model, now)
  return toAgent(row)
}
