import type { Catalog, ConnectMethod } from "@kiko/protocol"
import { BACKEND } from "../lib/version"
import { buildCatalog } from "./build"
import { catalogRevision, customSpec, providers } from "./catalog"
import { isStale, restoreOverlay, type SyncDeps, syncCatalog } from "./sync"

type Deps = SyncDeps & {
  signInMethod: (providerId: string) => ConnectMethod | undefined
  changed: () => void
}

export class ModelCatalog {
  #syncing: Promise<boolean> | undefined
  #built: { revision: string; catalog: Catalog } | undefined

  constructor(private readonly d: Deps) {}

  async init(): Promise<void> {
    restoreOverlay(this.d.sql)
  }

  syncIfStale(): void {
    if (isStale(this.d.sql, this.d.now())) void this.sync()
  }

  sync(): Promise<boolean> {
    this.#syncing ??= syncCatalog(this.d)
      .then((changed) => {
        if (changed) this.d.changed()
        return changed
      })
      .finally(() => {
        this.#syncing = undefined
      })
    return this.#syncing
  }

  current(): Catalog {
    if (isStale(this.d.sql, this.d.now())) void this.sync()
    const revision = `${BACKEND.version}:${catalogRevision()}`
    if (this.#built?.revision !== revision)
      this.#built = {
        revision,
        catalog: buildCatalog(providers(), this.d.signInMethod, (id) => {
          const spec = customSpec(id)
          return spec ? { api: spec.api, baseUrl: spec.baseUrl } : undefined
        }),
      }
    return this.#built.catalog
  }
}
