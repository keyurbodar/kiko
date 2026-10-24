import type { Catalog, CatalogModel, CatalogProvider, ConnectMethod } from "@kiko/protocol"
import { executeAtomQuery } from "@kiko/client-runtime/state"
import { owner, registry } from "../state/runtime"

export type { Catalog, CatalogModel, CatalogProvider, ConnectMethod }

export const catalogQuery = () => owner.queries.modelsCatalog(undefined)

export function prefetchCatalog(): void {
  void executeAtomQuery(registry, catalogQuery())
}
