import {
  type AgentModel,
  type Catalog,
  type CatalogModel,
  type CatalogProvider,
  clampThinking,
  type ConnectMethod,
  defaultThinking,
} from "@kiko/protocol"
import { executeAtomQuery } from "@kiko/client-runtime/state"
import { createQuery, owner, registry } from "../state/runtime"

export type { Catalog, CatalogModel, CatalogProvider, ConnectMethod }

export const catalogQuery = () => owner.queries.modelsCatalog(undefined)

export function prefetchCatalog(): void {
  void executeAtomQuery(registry, catalogQuery())
}

export function withLiveLevels(model: AgentModel | undefined, catalog: Catalog | undefined): AgentModel | undefined {
  if (!model) return model
  const at = model.model.indexOf("/")
  const live = catalog?.providers
    .find((p) => p.id === model.model.slice(0, at))
    ?.models.find((m) => m.id === model.model.slice(at + 1))
  if (!live?.thinking.length) return model
  return {
    ...model,
    thinkingLevels: live.thinking,
    thinking: model.thinkingLevels.some((level) => level !== "off")
      ? clampThinking(live.thinking, model.thinking)
      : defaultThinking(live.thinking),
  }
}

export function useLiveModel(model: () => AgentModel | undefined): () => AgentModel | undefined {
  const catalog = createQuery(catalogQuery)
  return () => withLiveLevels(model(), catalog())
}
