import type { Catalog, ConnectMethod } from "@kiko/protocol"
import { BACKEND } from "../lib/version"
import { buildCatalog } from "./build"
import { overlayRevision, providers } from "./catalog"
import { isStale, restoreOverlay, type SyncDeps, syncCatalog } from "./sync"

type Deps = SyncDeps & {
  signInMethod: (providerId: string) => ConnectMethod | undefined
  changed: () => void
}

export class ModelCatalog {
  #syncing: Promise<boolean> | undefined
  #built: { revision: string; json: string } | undefined

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

  async catalog(have: string | null): Promise<{ revision: string; json: string | null }> {
    if (isStale(this.d.sql, this.d.now())) void this.sync()
    const revision = `${BACKEND.version}:${overlayRevision()}`
    if (have === revision) return { revision, json: null }
    if (this.#built?.revision !== revision) {
      const catalog: Catalog = buildCatalog(providers(), this.d.signInMethod)
      this.#built = { revision, json: JSON.stringify(catalog) }
    }
    return { revision, json: this.#built.json }
  }
}
