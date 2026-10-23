import { type AgentModel, type AgentSlug, KIKO, type ThinkingLevel } from "@kiko/protocol"
import { isKnownModel, modelName, parseModelRef, supportedThinking, thinkingFor } from "../agent/thinking"
import { getSetting, setSetting } from "../lib/settings"

const PREFIX = "agentModel:"

type Pick = { model?: string; thinking?: ThinkingLevel }

const readPick = (sql: SqlStorage, slug: string): Pick => {
  const text = getSetting(sql, PREFIX + slug)
  return text ? (JSON.parse(text) as Pick) : {}
}

const resolve = (sql: SqlStorage, slug: string, pick: Pick): AgentModel | null => {
  const made = sql.exec<{ model: string }>("SELECT model FROM agents WHERE slug = ?", slug).toArray()[0]?.model
  const ref = [pick.model, made].map((r) => (r ? parseModelRef(r) : null)).find((r) => r !== null)
  if (!ref) return null
  const name = modelName(ref)
  return {
    model: `${ref.provider}/${ref.modelId}`,
    ...(name ? { name } : {}),
    thinking: thinkingFor(ref, pick.thinking),
    thinkingLevels: supportedThinking(ref),
  }
}

export function agentModel(sql: SqlStorage, slug: string): AgentModel | null {
  return resolve(sql, slug, readPick(sql, slug))
}

export function allAgentModels(sql: SqlStorage): Record<string, AgentModel> {
  const slugs = new Set<string>([KIKO])
  for (const row of sql.exec<{ slug: string }>("SELECT slug FROM agents").toArray()) slugs.add(row.slug)
  for (const row of sql.exec<{ key: string }>("SELECT key FROM settings WHERE key LIKE ?", `${PREFIX}%`).toArray())
    slugs.add(row.key.slice(PREFIX.length))
  return Object.fromEntries(
    [...slugs].flatMap((slug) => {
      const model = agentModel(sql, slug)
      return model ? [[slug, model]] : []
    }),
  )
}

export function saveAgentModel(
  sql: SqlStorage,
  slug: AgentSlug,
  ref?: string,
  thinking?: ThinkingLevel,
): AgentModel | null {
  const before = readPick(sql, slug)
  const model = ref ?? agentModel(sql, slug)?.model
  const parsed = model ? parseModelRef(model) : null
  if (!model || !parsed || !isKnownModel(parsed)) return null
  const wanted = thinking ?? before.thinking
  const next: Pick = { model, ...(wanted ? { thinking: thinkingFor(parsed, wanted) } : {}) }
  setSetting(sql, PREFIX + slug, JSON.stringify(next))
  return resolve(sql, slug, next)
}
