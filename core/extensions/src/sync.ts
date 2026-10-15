/**
 * Remembers the last extension sync of one agent object. The same version list on the same
 * `UserExtensions` is not synced again, even when it had problems: a problem comes from a bundle's
 * hash, so a rerun would only fail the same way and repeat its report. A new list, or a new
 * instance, syncs again. A sync that throws is not remembered.
 */
export class SyncMemo {
  #last?: { on: object; key: string }
  #pruned?: string

  async apply(on: object, versions: readonly unknown[], sync: (key: string) => Promise<unknown>): Promise<void> {
    const key = JSON.stringify(versions)
    if (this.#last?.on === on && this.#last.key === key) return
    await sync(key)
    this.#last = { on, key }
  }

  /** True the first time a version list is seen, so the stored bundles are scanned only when the list changed. */
  firstSight(key: string): boolean {
    if (this.#pruned === key) return false
    this.#pruned = key
    return true
  }
}
