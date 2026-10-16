import { type AgentModel, type AgentSlug, KIKO, type ThinkingLevel } from "@kiko/protocol"
import { DEFAULT_MODEL } from "../agent/factory"
import { isKnownModel, parseModelRef, supportedThinking, thinkingFor } from "../agent/thinking"
import { getSetting, setSetting } from "../lib/settings"

const PREFIX = "agentModel:"

type Pick = { model?: string; thinking?: ThinkingLevel }

const readPick = (sql: SqlStorage, slug: string): Pick => {
  const text = getSetting(sql, PREFIX + slug)
  return text ? (JSON.parse(text) as Pick) : {}
}

const resolve = (sql: SqlStorage, slug: string, pick: Pick): AgentModel => {
  const fallback = sql.exec<{ model: string }>("SELECT model FROM agents WHERE slug = ?", slug).toArray()[0]?.model
  const ref = [pick.model, fallback].map((r) => (r ? parseModelRef(r) : null)).find((r) => r && isKnownModel(r)) ?? DEFAULT_MODEL
  return { model: `${ref.provider}/${ref.modelId}`, thinking: thinkingFor(ref, pick.thinking), thinkingLevels: supportedThinking(ref) }
}

/** The model and reasoning level an agent runs on in every chat. */
export function agentModel(sql: SqlStorage, slug: string): AgentModel {
  return resolve(sql, slug, readPick(sql, slug))
}

/** Kiko, every agent the owner made, and every agent with a saved pick. */
export function allAgentModels(sql: SqlStorage): Record<string, AgentModel> {
  const slugs = new Set<string>([KIKO])
  for (const row of sql.exec<{ slug: string }>("SELECT slug FROM agents").toArray()) slugs.add(row.slug)
  for (const row of sql.exec<{ key: string }>("SELECT key FROM settings WHERE key LIKE ?", `${PREFIX}%`).toArray()) slugs.add(row.key.slice(PREFIX.length))
  return Object.fromEntries([...slugs].map((slug) => [slug, agentModel(sql, slug)]))
}

/**
 * Saves a pick and returns what the agent now runs on, or null when the model is not one pi-ai lists.
 * The level is clamped to what the model supports.
 */
export function saveAgentModel(sql: SqlStorage, slug: AgentSlug, ref?: string, thinking?: ThinkingLevel): AgentModel | null {
  const before = readPick(sql, slug)
  const model = ref ?? agentModel(sql, slug).model
  const parsed = parseModelRef(model)
  if (!parsed || !isKnownModel(parsed)) return null
  const wanted = thinking ?? before.thinking
  const next: Pick = { model, ...(wanted ? { thinking: thinkingFor(parsed, wanted) } : {}) }
  setSetting(sql, PREFIX + slug, JSON.stringify(next))
  return resolve(sql, slug, next)
}
