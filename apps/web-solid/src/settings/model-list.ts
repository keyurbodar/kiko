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

const VERSION = /\d+(?:\.\d+)*/g

function versionOf(name: string): number[] {
  return (name.match(VERSION) ?? []).flatMap((part) => part.split(".").map(Number))
}

function newer(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff > 0
  }
  return false
}

export function legacyModelIds(models: readonly CatalogModel[]): Set<string> {
  const families = new Map<string, CatalogModel[]>()
  for (const model of models) {
    const family = model.name
      .toLowerCase()
      .replace(VERSION, "")
      .replace(/\((new|latest)\)/g, "")
      .replace(/\s+/g, " ")
      .trim()
    families.set(family, [...(families.get(family) ?? []), model])
  }
  const legacy = new Set<string>()
  for (const group of families.values()) {
    const versions = group.map((model) => versionOf(model.name))
    const best = versions.reduce((top, v) => (newer(v, top) ? v : top), versions[0]!)
    group.forEach((model, i) => {
      if (versions[i]!.length > 0 && newer(best, versions[i]!)) legacy.add(model.id)
    })
  }
  return legacy
}

export type PickerEntry =
  | { kind: "legacy"; key: string; count: number; open: boolean }
  | { kind: "row"; key: string; row: ModelRow; at: number; mixed: boolean }

export function pickerEntries(input: {
  providers: readonly CatalogProvider[]
  starred: readonly string[]
  hidden: readonly string[]
  current: string | undefined
  filter: string
  query: string
  legacyOpen?: boolean
}): PickerEntry[] {
  const hidden = new Set(input.hidden)
  const starred = new Set(input.starred)
  const refOf = (r: ModelRow) => modelRef(r.provider.id, r.model.id)
  const visible = (r: ModelRow) => !hidden.has(refOf(r)) || refOf(r) === input.current
  const scope =
    input.filter === STARRED || input.query.trim()
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
  const rows = searchModels(scope, "").filter(visible)
  const old = scope[0] ? legacyModelIds(scope[0].models) : new Set<string>()
  const isLegacy = (r: ModelRow) => old.has(r.model.id) && !starred.has(refOf(r)) && refOf(r) !== input.current
  const main = rows.filter((r) => !isLegacy(r))
  push([...main.filter((r) => starred.has(refOf(r))), ...main.filter((r) => !starred.has(refOf(r)))], false)
  const legacy = rows.filter(isLegacy)
  if (!legacy.length) return out
  out.push({ kind: "legacy", key: `legacy:${input.filter}`, count: legacy.length, open: !!input.legacyOpen })
  if (input.legacyOpen) push(legacy, false)
  return out
}
