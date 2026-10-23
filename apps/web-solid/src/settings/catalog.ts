import type { Catalog, CatalogModel, CatalogProvider, ConnectMethod } from "@kiko/protocol"
import { executeAtomQuery } from "@kiko/client-runtime/state"
import { owner, registry } from "../state/runtime"

export type { Catalog, CatalogModel, CatalogProvider, ConnectMethod }

export const catalogQuery = () => owner.queries.modelsCatalog(undefined)

export function prefetchCatalog(): void {
  void executeAtomQuery(registry, catalogQuery())
}

export function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${+(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(tokens)
}

function dollars(value: number): string {
  if (value === 0) return "0"
  return String(value >= 1 ? +value.toFixed(2) : +value.toFixed(3))
}

export function formatPrice(pricing: { input: number; output: number }): string {
  if (pricing.input === 0 && pricing.output === 0) return "Free"
  return `$${dollars(pricing.input)} in / $${dollars(pricing.output)} out per 1M`
}

export interface ModelRow {
  provider: CatalogProvider
  model: CatalogModel
}

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

export function modelRef(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`
}
