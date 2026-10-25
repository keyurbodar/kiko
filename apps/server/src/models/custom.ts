import { type Api, envApiKeyAuth, type Model, type Provider } from "@earendil-works/pi-ai"
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy"
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy"
import { createProvider } from "@earendil-works/pi-ai/models"
import { builtinProviders } from "@earendil-works/pi-ai/providers/all"
import type { CustomApi } from "@kiko/protocol"

export type CustomModel = { id: string; name: string }

export type CustomSpec = {
  id: string
  name: string
  api: CustomApi
  baseUrl: string
  models: CustomModel[]
}

const MAX_MODELS = 400
const FALLBACK = { contextWindow: 128_000, maxTokens: 16_384 }

export function customId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
  return `custom-${slug || "provider"}`
}

export const isCustomId = (id: string): boolean => id.startsWith("custom-")

export function cleanBaseUrl(api: CustomApi, input: string): string | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== "https:") return null
  const path = url.pathname.replace(/\/+$/, "")
  const base = `${url.origin}${api === "anthropic-messages" ? path.replace(/\/v1$/, "") : path}`
  return base
}

const modelsUrl = (spec: Pick<CustomSpec, "api" | "baseUrl">) =>
  spec.api === "anthropic-messages" ? `${spec.baseUrl}/v1/models?limit=1000` : `${spec.baseUrl}/models`

function headers(api: CustomApi, key: string): Record<string, string> {
  return api === "anthropic-messages"
    ? { "x-api-key": key, "anthropic-version": "2023-06-01", accept: "application/json" }
    : { authorization: `Bearer ${key}`, accept: "application/json" }
}

export function parseModels(body: unknown): CustomModel[] {
  const list = (body as { data?: unknown } | null)?.data ?? body
  if (!Array.isArray(list)) return []
  const seen = new Map<string, CustomModel>()
  for (const entry of list) {
    const id = (entry as { id?: unknown } | null)?.id
    if (typeof id !== "string" || !id.trim() || seen.has(id)) continue
    const named =
      (entry as { display_name?: unknown; name?: unknown }).display_name ?? (entry as { name?: unknown }).name
    seen.set(id, { id, name: typeof named === "string" && named.trim() ? named.trim() : id })
  }
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, MAX_MODELS)
}

export type FetchOutcome =
  | { ok: true; models: CustomModel[] }
  | { ok: false; reason: "refused" | "unreachable" | "empty" }

export async function fetchUpstream(
  spec: Pick<CustomSpec, "api" | "baseUrl">,
  key: string,
  fetcher: typeof fetch,
): Promise<FetchOutcome> {
  let response: Response
  try {
    response = await fetcher(modelsUrl(spec), { headers: headers(spec.api, key) })
  } catch {
    return { ok: false, reason: "unreachable" }
  }
  if (response.status === 401 || response.status === 403) return { ok: false, reason: "refused" }
  if (!response.ok) return { ok: false, reason: "unreachable" }
  const models = parseModels(await response.json().catch(() => null))
  return models.length ? { ok: true, models } : { ok: false, reason: "empty" }
}

let known: Map<string, Model<Api>> | undefined

function knownModel(id: string, api: CustomApi): Model<Api> | undefined {
  if (!known) {
    known = new Map()
    for (const provider of builtinProviders())
      for (const model of provider.getModels()) {
        const key = `${model.api}\0${model.id}`
        if (!known.has(key)) known.set(key, model)
        if (!known.has(`*\0${model.id}`)) known.set(`*\0${model.id}`, model)
      }
  }
  const bare = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id
  return known.get(`${api}\0${id}`) ?? known.get(`${api}\0${bare}`) ?? known.get(`*\0${id}`) ?? known.get(`*\0${bare}`)
}

function toModel(spec: CustomSpec, entry: CustomModel): Model<Api> {
  const match = knownModel(entry.id, spec.api)
  const sameApi = match?.api === spec.api
  return {
    id: entry.id,
    name: entry.name !== entry.id ? entry.name : (match?.name.replace(/\s*\(latest\)$/i, "") ?? entry.id),
    api: spec.api,
    provider: spec.id,
    baseUrl: spec.baseUrl,
    reasoning: match?.reasoning ?? false,
    ...(sameApi && match?.thinkingLevelMap ? { thinkingLevelMap: match.thinkingLevelMap } : {}),
    input: match?.input ?? ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: match?.contextWindow ?? FALLBACK.contextWindow,
    maxTokens: match?.maxTokens ?? FALLBACK.maxTokens,
  } as Model<Api>
}

export function customProvider(spec: CustomSpec): Provider {
  return createProvider({
    id: spec.id,
    name: spec.name,
    baseUrl: spec.baseUrl,
    auth: { apiKey: envApiKeyAuth(`${spec.name} API key`, []) },
    models: spec.models.map((entry) => toModel(spec, entry)),
    api: spec.api === "anthropic-messages" ? anthropicMessagesApi() : openAICompletionsApi(),
  }) as Provider
}
