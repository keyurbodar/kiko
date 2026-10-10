// The model catalog the settings screen reads, and the pure helpers around it.
// The catalog is a hashed static asset (architecture 11.5). It is fetched when
// settings or the model picker first opens, never bundled.

export type ConnectMethod = "api_key" | "device_code" | "paste_code"

export interface CatalogModel {
  id: string
  name: string
  contextWindow: number
  maxTokens: number
  reasoning: boolean
  /** Dollars per million tokens. */
  pricing: { input: number; output: number }
}

export interface CatalogProvider {
  id: string
  name: string
  connect: ConnectMethod[]
  models: CatalogModel[]
  /** How many classifier models the provider serves. */
  classifiers: number
}

export interface Catalog {
  providers: CatalogProvider[]
}

let cached: Promise<Catalog> | undefined
let forget: ReturnType<typeof setTimeout> | undefined
/**
 * How long the parsed catalog (about 2 MB) outlives its last request. A screen that reads it holds
 * its own copy while open; after that the file is in the HTTP cache, so the next open costs a parse.
 */
export const CATALOG_KEEP_MS = 60_000

/** Loads the catalog once. A failed load is not cached, so the next open retries. */
export function loadCatalog(): Promise<Catalog> {
  if (forget !== undefined) clearTimeout(forget)
  forget = setTimeout(() => {
    cached = undefined
    forget = undefined
  }, CATALOG_KEEP_MS)
  cached ??= (async () => {
    const { default: url } = await import("virtual:yuki-model-catalog")
    const response = await fetch(url)
    if (!response.ok) throw new Error("catalog request failed")
    return (await response.json()) as Catalog
  })().catch((error) => {
    cached = undefined
    throw error
  })
  return cached
}

/** "128K", "1M", "8K". Context sizes are shown in thousands or millions of tokens. */
export function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${+(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(tokens)
}

function dollars(value: number): string {
  if (value === 0) return "0"
  return String(value >= 1 ? +value.toFixed(2) : +value.toFixed(3))
}

/** "$0.14 in / $0.28 out per 1M", or "Free". */
export function formatPrice(pricing: { input: number; output: number }): string {
  if (pricing.input === 0 && pricing.output === 0) return "Free"
  return `$${dollars(pricing.input)} in / $${dollars(pricing.output)} out per 1M`
}

export interface ModelRow {
  provider: CatalogProvider
  model: CatalogModel
}

/** Every model of the given providers whose names and ids hold every search word. */
export function searchModels(providers: readonly CatalogProvider[], query: string): ModelRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const rows: ModelRow[] = []
  for (const provider of providers) {
    for (const model of provider.models) {
      const haystack = `${provider.name} ${provider.id} ${model.name} ${model.id}`.toLowerCase()
      if (words.every((word) => haystack.includes(word))) rows.push({ provider, model })
    }
  }
  return rows
}

/** The picked model as one string, `provider/model`. The form the server and the CLI use. */
export function modelRef(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`
}
