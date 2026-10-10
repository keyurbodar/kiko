import { KernelError, type KernelClient, type Mode } from "./client"
import type { KernelStore, LeaseRow, Tabs } from "./store"

/** What the lease needs of the store, so a test can pass a table in memory. */
export type LeaseStore = Pick<KernelStore, "lease" | "urls" | "putLease" | "patchLease" | "deleteLease" | "profileReady" | "setProfileReady" | "setBroken" | "generation">

/** A browser nobody called for this long is deleted. */
export const IDLE_MS = 5 * 60_000
/** A browser older than this is deleted, whoever uses it. */
export const LIFETIME_MS = 30 * 60_000
/** While the human drives, the reaper looks again this often. */
export const TAKEOVER_RECHECK_MS = 60_000
/** Kernel's own net if our reaper misses. */
export const KERNEL_TIMEOUT_SECONDS = 600
/** A 429 with a longer `Retry-After` than this is returned as busy. */
export const MAX_RETRY_AFTER_S = 5
/** Tabs one browser holds at most, from the phase file. */
export const MAX_TABS = 8

export const REAP_WAKEUP = "kernel_reap"

export type ReapDecision = { delete: true } | { delete: false; at: number }

/** The whole reaper policy, as data in and a verdict out. */
export function reapDecision(row: Pick<LeaseRow, "createdAt" | "lastUse" | "takeover" | "watchUntil" | "dead">, now: number): ReapDecision {
  if (row.dead) return { delete: true }
  if (row.takeover) return { delete: false, at: now + TAKEOVER_RECHECK_MS }
  if (row.watchUntil > now) return { delete: false, at: row.watchUntil }
  const at = Math.min(row.lastUse + IDLE_MS, row.createdAt + LIFETIME_MS)
  return at <= now ? { delete: true } : { delete: false, at }
}

export type LeaseInfo = {
  cdpUrl: string
  mode: Mode
  /** The browser was dead and this one replaced it. */
  restarted: boolean
  /** With `restarted`: the caller's tabs' last URLs, to reopen. */
  reopen: string[]
}

export type Switched = { cdpUrl: string; mode: Mode; tabs: Record<string, string[]> }

export type LeaseDeps = {
  store: LeaseStore
  /** The client for the stored key. Throws when no key is stored. */
  client: () => Promise<KernelClient>
  /** The user's profile name, from the user's own id. */
  profile: () => Promise<string>
  /** Points the one reaper wakeup. */
  wake: { set(at: number): Promise<void>; clear(): Promise<void> }
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

function urlsOf(tabs: Tabs): Record<string, string[]> {
  return Object.fromEntries(Object.entries(tabs).map(([agent, t]) => [agent, Object.values(t)]))
}

/**
 * One user's one browser. Every change runs one at a time, so two callers never create two
 * browsers: the second finds the first one's row. `UserDO` owns the one instance for its user.
 */
export class KernelLease {
  #queue: Promise<unknown> = Promise.resolve()
  readonly #now: () => number
  readonly #sleep: (ms: number) => Promise<void>

  constructor(private readonly deps: LeaseDeps) {
    this.#now = deps.now ?? Date.now
    this.#sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  #serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(fn, fn)
    this.#queue = run.catch(() => undefined)
    return run
  }

  /** The browser for `agentId`: the live one, or a new headless one. */
  lease(agentId: string): Promise<LeaseInfo> {
    return this.#serial(async () => {
      const { store } = this.deps
      const row = store.lease()
      if (row && !reapDecision(row, this.#now()).delete) {
        const urls = await store.urls()
        if (urls) {
          this.#touch(row, agentId)
          return { cdpUrl: urls.cdpUrl, mode: row.mode, restarted: false, reopen: [] }
        }
      }
      const reopen = row ? Object.values(row.tabs[agentId] ?? {}) : []
      if (row) await this.#destroy(row)
      const made = await this.#create("headless", { takeover: false, watchUntil: 0 })
      this.#touch(made.row, agentId)
      return { cdpUrl: made.cdpUrl, mode: "headless", restarted: row?.dead === true, reopen: row?.dead ? reopen : [] }
    })
  }

  /** Stamps last use, and replaces the agent's tabs when it reports them. Reports whether the browser is still the one it knew. */
  touch(agentId: string, tabs?: Record<string, string>): boolean {
    const row = this.deps.store.lease()
    if (!row || row.dead) return false
    this.#touch(row, agentId, tabs)
    return true
  }

  /** The agent closed its tabs. */
  release(agentId: string): void {
    const row = this.deps.store.lease()
    if (!row) return
    const { [agentId]: _, ...tabs } = row.tabs
    this.deps.store.patchLease({ tabs, lastUse: this.#now() })
  }

  /** An agent's socket died. The next lease makes a new browser. */
  dead(): void {
    this.deps.store.patchLease({ dead: true })
  }

  setTakeover(on: boolean): void {
    this.deps.store.patchLease({ takeover: on, lastUse: this.#now() })
  }

  /** The reaper keeps the browser until `until`. */
  watchUntil(until: number): void {
    this.deps.store.patchLease({ watchUntil: until, lastUse: this.#now() })
  }

  /**
   * Replaces the browser with one in `mode` on the same profile. The old one is deleted first and
   * its save finishes before the new one starts, so there is never a second writer. Returns the
   * tabs' last URLs by agent, to reopen.
   */
  switchMode(mode: Mode): Promise<Switched> {
    return this.#serial(async () => {
      const { store } = this.deps
      const row = store.lease()
      if (row && row.mode === mode && !row.dead && !reapDecision(row, this.#now()).delete) {
        const urls = await store.urls()
        if (urls) return { cdpUrl: urls.cdpUrl, mode, tabs: {} }
      }
      if (row) await this.#destroy(row)
      const made = await this.#create(mode, { takeover: row?.takeover ?? false, watchUntil: row?.watchUntil ?? 0, tabs: row?.tabs ?? {} })
      return { cdpUrl: made.cdpUrl, mode, tabs: row ? urlsOf(row.tabs) : {} }
    })
  }

  /** The reaper's wakeup: delete the browser when its time is up, otherwise look again later. */
  reap(): Promise<void> {
    return this.#serial(async () => {
      const row = this.deps.store.lease()
      if (!row) return this.deps.wake.clear()
      const verdict = reapDecision(row, this.#now())
      if (verdict.delete) await this.#destroy(row)
      else await this.deps.wake.set(verdict.at)
    })
  }

  /** Deletes the browser, if any. A browser that is already gone counts as deleted. */
  close(): Promise<void> {
    return this.#serial(async () => {
      const row = this.deps.store.lease()
      if (row) await this.#destroy(row)
    })
  }

  /** Account deletion: the browser, then the profile with its saved logins. */
  wipe(): Promise<void> {
    return this.#serial(async () => {
      const row = this.deps.store.lease()
      if (row) await this.#destroy(row)
      const client = await this.deps.client()
      try {
        await client.deleteProfile(await this.deps.profile())
      } catch (e) {
        if (!(e instanceof KernelError && e.kind === "not_found")) throw this.#mark(e)
      }
    })
  }

  status(): { mode: Mode; tabs: Record<string, number> } | null {
    const row = this.deps.store.lease()
    if (!row || row.dead) return null
    return { mode: row.mode, tabs: Object.fromEntries(Object.entries(row.tabs).map(([agent, t]) => [agent, Object.keys(t).length])) }
  }

  #touch(row: LeaseRow, agentId: string, tabs?: Record<string, string>): void {
    const next = { ...row.tabs }
    if (tabs && Object.keys(tabs).length) next[agentId] = tabs
    else if (tabs) delete next[agentId]
    else next[agentId] ??= {}
    this.deps.store.patchLease({ lastUse: this.#now(), tabs: next })
  }

  async #create(mode: Mode, keep: Pick<LeaseRow, "takeover" | "watchUntil"> & { tabs?: Tabs }): Promise<{ cdpUrl: string; row: LeaseRow }> {
    const { store, wake } = this.deps
    const client = await this.deps.client()
    const profile = await this.deps.profile()
    const generation = store.generation
    try {
      if (!store.profileReady()) {
        try {
          await client.createProfile(profile)
        } catch (e) {
          if (!(e instanceof KernelError && e.kind === "conflict")) throw e
        }
        store.setProfileReady(true)
      }
      const made = await this.#retrying(() => client.createBrowser({ headless: mode === "headless", profile, timeoutSeconds: KERNEL_TIMEOUT_SECONDS }))
      const now = this.#now()
      const row: LeaseRow = { sessionId: made.sessionId, mode, createdAt: now, lastUse: now, tabs: {}, dead: false, ...keep }
      if (!(await store.putLease(row, { cdpUrl: made.cdpUrl, ...(made.liveUrl ? { liveUrl: made.liveUrl } : {}) }, generation))) {
        // Disconnected while the browser was being made.
        await client.deleteBrowser(made.sessionId).catch(() => undefined)
        throw new KernelError("failed", "Kernel was disconnected")
      }
      await wake.set(reapDecisionAt(row, now))
      return { cdpUrl: made.cdpUrl, row }
    } catch (e) {
      throw this.#mark(e)
    }
  }

  /** 429 waits once when `Retry-After` is short, 529 retries once. Anything else is the caller's. */
  async #retrying<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op()
    } catch (e) {
      if (!(e instanceof KernelError)) throw e
      if (e.kind === "capacity") {
        await this.#sleep(1_000)
        return op()
      }
      if (e.kind === "rate_limited") {
        const wait = e.retryAfter ?? 2
        if (wait > MAX_RETRY_AFTER_S) throw new KernelError("rate_limited", `Kernel is busy. Try again in ${Math.ceil(wait)} s`, wait)
        await this.#sleep(wait * 1_000)
        return op()
      }
      throw e
    }
  }

  async #destroy(row: LeaseRow): Promise<void> {
    const { store, wake } = this.deps
    try {
      await (await this.deps.client()).deleteBrowser(row.sessionId)
    } catch (e) {
      if (e instanceof KernelError && e.kind === "unauthorized") {
        // The key cannot delete it. Kernel's own timeout will.
        this.#mark(e)
      } else if (!(e instanceof KernelError && e.kind === "not_found")) throw e
    }
    store.deleteLease()
    await wake.clear()
  }

  /** A rejected key is remembered, so Settings can say so. */
  #mark(e: unknown): unknown {
    if (e instanceof KernelError && e.kind === "unauthorized") this.deps.store.setBroken(true)
    return e
  }
}

function reapDecisionAt(row: LeaseRow, now: number): number {
  const v = reapDecision(row, now)
  return v.delete ? now : v.at
}
