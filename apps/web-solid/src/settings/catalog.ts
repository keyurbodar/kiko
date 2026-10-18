// The model catalog the settings screen reads, and the pure helpers around it.
// The server serves it at /api/models from its live copy of pi's catalog. It is
// fetched when settings or the model picker first opens, never bundled.

import type { Catalog, CatalogModel, CatalogProvider, ConnectMethod } from "@kiko/protocol"
import { apiFetch } from "../lib/api"
import { watchChanged } from "../sync/changed"

export type { Catalog, CatalogModel, CatalogProvider, ConnectMethod }

let cached: Promise<Catalog> | undefined
let forget: ReturnType<typeof setTimeout> | undefined
/**
 * How long the parsed catalog outlives its last request. The response is about 314 KB of JSON
 * (41 providers, 1,600 models) and the server answers it with `no-cache`, so every reopen without
 * this is a Worker round trip plus a parse. A provider list changes only when someone connects one,
 * and the server's `changed: models` frame drops it at once.
 */
export const CATALOG_KEEP_MS = 30 * 60_000

/** Starts the catalog download early. Shares `loadCatalog`'s promise, so the first open reuses it. */
export async function prefetchCatalog(): Promise<void> {
  try {
    await loadCatalog()
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
