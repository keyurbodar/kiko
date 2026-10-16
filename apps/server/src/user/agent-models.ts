import { type AgentModel, type AgentSlug, KIKO, type ThinkingLevel } from "@kiko/protocol"
import type { ModelRef } from "@earendil-works/pi-durable"
import { DEFAULT_MODEL } from "../agent/factory"
import { isKnownModel, parseModelRef, supportedThinking, thinkingFor } from "../agent/thinking"
import { getSetting, setSetting } from "../lib/settings"
import { findProvider } from "./turn-context"

const PREFIX = "agentModel:"

type Pick = { model?: string; thinking?: ThinkingLevel }

const readPick = (sql: SqlStorage, slug: string): Pick => {
  const text = getSetting(sql, PREFIX + slug)
  return text ? (JSON.parse(text) as Pick) : {}
}

/**
 * What an agent runs on when nobody picked: the default model, unless the owner has keys and none is
 * for its provider. Then the best chat model of a connected provider, reasoning and the largest
 * context first, the order the first-run model step lists them in.
 */
function defaultModel(sql: SqlStorage): ModelRef {
  const connected = sql.exec<{ provider_id: string }>("SELECT provider_id FROM credentials ORDER BY provider_id").toArray().map((r) => r.provider_id)
  if (!connected.length || connected.includes(DEFAULT_MODEL.provider)) return DEFAULT_MODEL
  const best = connected
    .flatMap((id) => findProvider(id)?.getModels().map((m) => ({ provider: id, modelId: m.id, reasoning: m.reasoning, contextWindow: m.contextWindow })) ?? [])
    .sort((a, b) => Number(b.reasoning) - Number(a.reasoning) || b.contextWindow - a.contextWindow)[0]
  return best ?? DEFAULT_MODEL
}

const resolve = (sql: SqlStorage, slug: string, pick: Pick): AgentModel => {
  const fallback = sql.exec<{ model: string }>("SELECT model FROM agents WHERE slug = ?", slug).toArray()[0]?.model
  const ref = [pick.model, fallback].map((r) => (r ? parseModelRef(r) : null)).find((r) => r && isKnownModel(r)) ?? defaultModel(sql)
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
