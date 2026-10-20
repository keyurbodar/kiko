import type { AnyModel, Provider } from "@earendil-works/pi-ai"
import { getModelType } from "@earendil-works/pi-ai/models"
import { builtinProviders } from "@earendil-works/pi-ai/providers/all"

export type CatalogOverlay = Record<string, AnyModel[]>

export type WireModel = { [key: string]: string | number | boolean | null | WireModel | (string | number | boolean | null | WireModel)[] }

const MODEL_TYPES = new Set(["chat", "image", "classifier"])

const keyOf = (model: AnyModel) => `${getModelType(model)}\0${model.id}`

function merge(baseline: readonly AnyModel[], extra: readonly AnyModel[]): AnyModel[] {
  const merged = new Map<string, AnyModel>()
  for (const model of [...baseline, ...extra]) merged.set(keyOf(model), model)
  return [...merged.values()]
}

let overlay: CatalogOverlay = {}
let revision = ""
let bundled: Provider[] | undefined
let wrapped: Map<string, Provider> | undefined

function bundledProviders(): Provider[] {
  bundled ??= builtinProviders()
  return bundled
}

function overlaid(provider: Provider): Provider {
  const chat = (model: AnyModel) => getModelType(model) === "chat"
  return {
    ...provider,
    getModels: () => {
      const extra = overlay[provider.id]
      return extra ? (merge(provider.getModels(), extra.filter(chat)) as never) : provider.getModels()
    },
    getAllModels: () => {
      const all = provider.getAllModels?.() ?? provider.getModels()
      const extra = overlay[provider.id]
      return extra ? (merge(all, extra) as never) : all
    },
  }
}

export function providers(): Provider[] {
  wrapped ??= new Map(bundledProviders().map((p) => [p.id, overlaid(p)]))
  return [...wrapped.values()]
}

export function findProvider(id: string): Provider | undefined {
  providers()
  return wrapped?.get(id)
}

export function applyOverlay(next: CatalogOverlay, nextRevision = ""): void {
  overlay = next
  revision = nextRevision
}

export function overlayRevision(): string {
  return revision
}

export function setOverlay(providerId: string, models: readonly WireModel[]): void {
  const { [providerId]: _, ...rest } = overlay
  overlay = models.length ? { ...rest, [providerId]: [...models] as unknown as AnyModel[] } : rest
}

export function overlayFor(providerId: string): WireModel[] {
  return (overlay[providerId] ?? []) as unknown as WireModel[]
}

const num = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0

function parseModel(value: unknown, providerId: string): AnyModel | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const m = value as Record<string, unknown>
  if (!text(m.id) || !text(m.name) || !text(m.api)) return null
  if (m.type !== undefined && !(typeof m.type === "string" && MODEL_TYPES.has(m.type))) return null
  if ((m.type === undefined || m.type === "chat") && !(num(m.contextWindow) && num(m.maxTokens))) return null
  if (m.cost !== undefined) {
    const cost = m.cost as Record<string, unknown> | null
    if (typeof cost !== "object" || cost === null || !num(cost.input) || !num(cost.output)) return null
  }
  return { ...m, provider: providerId } as AnyModel
}

function stable(value: unknown): string {
  return JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v,
  )
}

export function computeOverlay(
  remote: unknown,
  lastModified: number,
  bundledGeneratedAt: number | undefined,
  base: readonly Provider[] = bundledProviders(),
): CatalogOverlay {
  const newer = bundledGeneratedAt === undefined || lastModified > bundledGeneratedAt
  if (!newer || typeof remote !== "object" || remote === null || Array.isArray(remote)) return {}
  const out: CatalogOverlay = {}
  for (const provider of base) {
    const entries = (remote as Record<string, unknown>)[provider.id]
    if (!Array.isArray(entries)) continue
    const own = provider.getAllModels?.() ?? provider.getModels()
    const apis = new Set(own.map((m) => m.api))
    const known = new Map(own.map((m) => [keyOf(m), stable(m)]))
    const kept: AnyModel[] = []
    for (const entry of entries) {
      const model = parseModel(entry, provider.id)
      if (!model || !apis.has(model.api) || known.get(keyOf(model)) === stable(model)) continue
      kept.push(model)
    }
    if (kept.length) out[provider.id] = kept
  }
  return out
}
