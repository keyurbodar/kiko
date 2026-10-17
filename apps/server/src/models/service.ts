import type { Alarms } from "@kiko/durable/alarm"
import type { Catalog, ConnectMethod } from "@kiko/protocol"
import { BACKEND } from "../lib/version"
import { buildCatalog } from "./build"
import { overlayRevision, providers } from "./catalog"
import { isStale, restoreOverlay, SYNC_INTERVAL_MS, type SyncDeps, syncCatalog } from "./sync"

export const CATALOG_WAKEUP = "models"

type Deps = SyncDeps & {
  alarms: Alarms
  signInMethod: (providerId: string) => ConnectMethod | undefined
  changed: () => void
}

/** The live model catalog of one owner: the hourly sync, the check on open, and the client's catalog json. */
export class ModelCatalog {
  #syncing: Promise<boolean> | undefined
  #built: { revision: string; json: string } | undefined

  constructor(private readonly d: Deps) {}

  async init(): Promise<void> {
    restoreOverlay(this.d.sql)
    const armed = this.d.sql.exec("SELECT 1 FROM wakeups WHERE key = ?", CATALOG_WAKEUP).toArray().length > 0
    if (!armed) await this.d.alarms.setWakeup(CATALOG_WAKEUP, this.d.now() + SYNC_INTERVAL_MS)
  }

  async wake(): Promise<void> {
    await this.d.alarms.setWakeup(CATALOG_WAKEUP, this.d.now() + SYNC_INTERVAL_MS)
    await this.sync()
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

  /**
   * The catalog json, or null when the caller already holds this revision. An old check starts a sync
   * without waiting for it, so opening settings never waits on pi.dev; a changed overlay reaches the
   * client as a `changed: models` frame.
   */
  async catalog(have: string | null): Promise<{ revision: string; json: string | null }> {
    if (isStale(this.d.sql, this.d.now())) void this.sync()
    // The catalog's shape also comes from this code (which providers Kiko can connect), so a new release is a new revision.
    const revision = `${BACKEND.version}:${overlayRevision()}`
    if (have === revision) return { revision, json: null }
    if (this.#built?.revision !== revision) {
      const catalog: Catalog = buildCatalog(providers(), this.d.signInMethod)
      this.#built = { revision, json: JSON.stringify(catalog) }
    }
    return { revision, json: this.#built.json }
  }
}
