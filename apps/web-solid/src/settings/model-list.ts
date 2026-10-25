import type { CatalogModel, CatalogProvider } from "@kiko/protocol"

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

const LONG_CONTEXT = 1_000_000
const FAST_OUTPUT_PRICE = 2

export function modelTrait(model: Pick<CatalogModel, "contextWindow" | "pricing">): string {
  if (model.pricing.input === 0 && model.pricing.output === 0) return "Free"
  if (model.pricing.output <= FAST_OUTPUT_PRICE) return "Fast"
  return model.contextWindow >= LONG_CONTEXT ? `${formatContext(model.contextWindow)} context` : "Smart"
}

export const modelDetail = (model: Pick<CatalogModel, "contextWindow" | "pricing">) =>
  `${formatContext(model.contextWindow)} context, ${formatPrice(model.pricing)}`

export function shortModelName(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length < 3) return name
  const rest = words.slice(1)
  const named = rest.filter((word) => !/\d/.test(word))
  return (named.length ? named : rest).join(" ")
}

export const ALL_PROVIDERS = "all"
export const STARRED = "starred"

export type PickerEntry =
  | { kind: "head"; key: string; label: string; provider?: CatalogProvider }
  | { kind: "row"; key: string; row: ModelRow; at: number; mixed: boolean }

export function pickerEntries(input: {
  providers: readonly CatalogProvider[]
  starred: readonly string[]
  hidden: readonly string[]
  current: string | undefined
  filter: string
  query: string
}): PickerEntry[] {
  const hidden = new Set(input.hidden)
  const starred = new Set(input.starred)
  const refOf = (r: ModelRow) => modelRef(r.provider.id, r.model.id)
  const visible = (r: ModelRow) => !hidden.has(refOf(r)) || refOf(r) === input.current
  const scope =
    input.filter === ALL_PROVIDERS || input.filter === STARRED
      ? input.providers
      : input.providers.filter((p) => p.id === input.filter)
  const out: PickerEntry[] = []
  let at = 0
  const push = (rows: readonly ModelRow[], mixed: boolean) => {
    for (const row of rows) out.push({ kind: "row", key: refOf(row), row, at: at++, mixed })
  }
  if (input.query.trim()) {
    push(searchModels(scope, input.query).filter(visible), scope.length > 1)
    return out
  }
  if (input.filter === STARRED) {
    push(
      searchModels(scope, "").filter((r) => starred.has(refOf(r))),
      scope.length > 1,
    )
    return out
  }
  if (input.filter !== ALL_PROVIDERS) {
    push(searchModels(scope, "").filter(visible), false)
    return out
  }
  const all = searchModels(scope, "")
  const stars = all.filter((r) => starred.has(refOf(r)))
  if (stars.length) {
    out.push({ kind: "head", key: "head:starred", label: "Starred" })
    push(stars, scope.length > 1)
  }
  for (const provider of scope) {
    const rows = all.filter((r) => r.provider.id === provider.id && !starred.has(refOf(r)) && visible(r))
    if (!rows.length) continue
    out.push({ kind: "head", key: `head:${provider.id}`, label: provider.name, provider })
    push(rows, false)
  }
  return out
}
