import { boundedWait } from "@kiko/durable/bounded-wait"
import { KernelError, type KernelClient, type Mode } from "./client"
import type { KernelStore, LeaseRow, Tabs } from "./store"

export type LeaseStore = Pick<KernelStore, "lease" | "urls" | "putLease" | "patchLease" | "deleteLease" | "profileReady" | "setProfileReady" | "setBroken">

export const IDLE_MS = 5 * 60_000
/** While the human drives, the reaper looks again this often. */
export const TAKEOVER_RECHECK_MS = 60_000
const KERNEL_TIMEOUT_SECONDS = 600
const MAX_RETRY_AFTER_S = 5
export const MAX_TABS = 8
/** The longest the human holds control. A takeover older than this is over, so a forgotten live view cannot pause agents for ever. */
export const TAKEOVER_MS = 30 * 60_000

export const REAP_WAKEUP = "kernel_reap"

export type ReapDecision = { delete: true } | { delete: false; at: number }

/** Control is data: the human holds it from the flag until `watchUntil`; a row from before the limit (`watchUntil` 0) holds until handed back. */
export function humanHolds(row: Pick<LeaseRow, "takeover" | "watchUntil">, now: number): boolean {
  return row.takeover && (row.watchUntil === 0 || row.watchUntil > now)
}

/** The whole reaper policy, as data in and a verdict out. A browser an agent used inside the idle window is never deleted, whatever its age. */
export function reapDecision(row: Pick<LeaseRow, "lastUse" | "takeover" | "watchUntil" | "dead">, now: number): ReapDecision {
  if (row.dead) return { delete: true }
  if (humanHolds(row, now)) return { delete: false, at: now + TAKEOVER_RECHECK_MS }
  if (row.watchUntil > now) return { delete: false, at: row.watchUntil }
  const at = row.lastUse + IDLE_MS
  return at <= now ? { delete: true } : { delete: false, at }
}

export type LeaseInfo = {
  sessionId: string
  cdpUrl: string
  mode: Mode
  restarted: boolean
  reopen: string[]
}

export type Switched = { cdpUrl: string; mode: Mode; tabs: Record<string, string[]> }

export type LeaseDeps = {
  store: LeaseStore
  client: () => Promise<KernelClient>
  profile: () => Promise<string>
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
    this.#sleep = deps.sleep ?? boundedWait
  }

  #serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(fn, fn)
    this.#queue = run.catch(() => undefined)
    return run
  }

  lease(agentId: string): Promise<LeaseInfo> {
    return this.#serial(async () => {
      const { store } = this.deps
      const row = store.lease()
      if (row && !reapDecision(row, this.#now()).delete) {
        const urls = await store.urls()
        if (urls) {
          this.#touch(row, agentId)
          return { sessionId: row.sessionId, cdpUrl: urls.cdpUrl, mode: row.mode, restarted: false, reopen: [] }
        }
      }
      const reopen = row ? Object.values(row.tabs[agentId] ?? {}) : []
      if (row) await this.#destroy(row)
      // Always headful: a live view link then reads the open browser's URL. Switching a headless one under a
      // working agent took seconds, timed out on Kernel's side, and closed the agent's pages.
      const made = await this.#create("headful", { takeover: false, watchUntil: 0 })
      this.#touch(made.row, agentId)
      return { sessionId: made.row.sessionId, cdpUrl: made.cdpUrl, mode: "headful", restarted: row?.dead === true, reopen: row?.dead ? reopen : [] }
    })
  }

  touch(agentId: string, tabs?: Record<string, string>): boolean {
    const row = this.deps.store.lease()
    if (!row || row.dead) return false
    this.#touch(row, agentId, tabs)
    return true
  }

  release(agentId: string): void {
    const row = this.deps.store.lease()
    if (!row) return
    const { [agentId]: _, ...tabs } = row.tabs
    this.deps.store.patchLease({ tabs, lastUse: this.#now() })
  }

  /**
   * An agent's socket to `sessionId` died. A socket also dies on our own idle close, a network blip,
   * or a mode switch, so the browser is marked dead only when it is still the current one and Kernel
   * says it is gone. Otherwise every other agent would lose its tabs.
   */
  dead(sessionId: string): Promise<boolean> {
    return this.#serial(async () => {
      const row = this.deps.store.lease()
      if (!row || row.dead || row.sessionId !== sessionId) return false
      if (await (await this.deps.client()).alive(sessionId)) return false
      this.deps.store.patchLease({ dead: true })
      return true
    })
  }

  /** DEVELOPMENT ONLY: ends the browser on Kernel's side, as Kernel's own timeout would. */
  async killForDev(): Promise<string | undefined> {
    const row = this.deps.store.lease()
    if (!row) return undefined
    await (await this.deps.client()).deleteBrowser(row.sessionId).catch(() => undefined)
    return row.sessionId
  }

  setTakeover(on: boolean): void {
    const now = this.#now()
    const row = this.deps.store.lease()
    this.deps.store.patchLease(on ? { takeover: true, watchUntil: Math.max(row?.watchUntil ?? 0, now + TAKEOVER_MS), lastUse: now } : { takeover: false, watchUntil: 0, lastUse: now })
  }

  watchUntil(until: number): void {
    const row = this.deps.store.lease()
    this.deps.store.patchLease({ watchUntil: Math.max(row?.watchUntil ?? 0, until), lastUse: this.#now() })
  }

  /**
   * Replaces the browser with one in `mode` on the same profile. The old one is deleted first and
   * its save finishes before the new one starts, so there is never a second writer.
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

  reap(): Promise<void> {
    return this.#serial(async () => {
      const row = this.deps.store.lease()
      if (!row) return this.deps.wake.clear()
      const now = this.#now()
      if (row.takeover && !humanHolds(row, now)) this.deps.store.patchLease({ takeover: false })
      const verdict = reapDecision(row, now)
      if (verdict.delete) await this.#destroy(row)
      else await this.deps.wake.set(verdict.at)
    })
  }

  close(): Promise<void> {
    return this.#serial(async () => {
      const row = this.deps.store.lease()
      if (row) await this.#destroy(row)
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
      await store.putLease(row, { cdpUrl: made.cdpUrl, ...(made.liveUrl ? { liveUrl: made.liveUrl } : {}) }).catch(async (e) => {
        await client.deleteBrowser(made.sessionId).catch(() => undefined)
        throw e
      })
      await wake.set(reapDecisionAt(row, now))
      return { cdpUrl: made.cdpUrl, row }
    } catch (e) {
      throw this.#mark(e)
    }
  }

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
