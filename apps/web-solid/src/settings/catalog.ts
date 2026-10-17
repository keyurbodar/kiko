// The model catalog the settings screen reads, and the pure helpers around it.
// The server serves it at /api/models from its live copy of pi's catalog (architecture 11.5). It is
// fetched when settings or the model picker first opens, never bundled.

import type { Catalog, CatalogModel, CatalogProvider, ConnectMethod } from "@kiko/protocol"
import { apiFetch } from "../lib/api"
import { watchChanged } from "../sync/changed"

export type { Catalog, CatalogModel, CatalogProvider, ConnectMethod }

let cached: Promise<Catalog> | undefined
let forget: ReturnType<typeof setTimeout> | undefined
/**
 * How long the parsed catalog (about 2 MB) outlives its last request. A screen that reads it holds
 * its own copy while open; after that the response is in the HTTP cache, so the next open costs a
 * revalidation and a parse.
 */
export const CATALOG_KEEP_MS = 60_000

/** Fetches the catalog into the HTTP cache without parsing it, so the first open skips the download. */
export async function prefetchCatalog(): Promise<void> {
  try {
    await apiFetch("/api/models")
  } catch {
    // the open retries
  }
}

/** Loads the catalog once. A failed load is not cached, so the next open retries. The server's `changed: models` frame drops it. */
export function loadCatalog(): Promise<Catalog> {
  watchChanged("models", () => {
    cached = undefined
  })
  if (forget !== undefined) clearTimeout(forget)
  forget = setTimeout(() => {
    cached = undefined
    forget = undefined
  }, CATALOG_KEEP_MS)
  cached ??= (async () => {
    const response = await apiFetch("/api/models")
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
