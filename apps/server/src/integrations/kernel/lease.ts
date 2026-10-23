import { boundedWait } from "@kiko/durable/bounded-wait"
import { KernelError, type KernelClient, type Mode } from "./client"
import type { KernelStore, LeaseRow, Tabs } from "./store"

type LeaseStore = Pick<
  KernelStore,
  "lease" | "urls" | "putLease" | "patchLease" | "deleteLease" | "profileReady" | "setProfileReady" | "setBroken"
>

const IDLE_MS = 24 * 60 * 60_000
const TAKEOVER_RECHECK_MS = 60_000
const KERNEL_TIMEOUT_SECONDS = 25 * 60 * 60
const MAX_RETRY_AFTER_S = 5
export const MAX_TABS = 8
const TAKEOVER_MS = 30 * 60_000

export const REAP_WAKEUP = "kernel_reap"

export type ReapDecision = { delete: true } | { delete: false; at: number }

export function humanHolds(row: Pick<LeaseRow, "takeover" | "watchUntil">, now: number): boolean {
  return row.takeover && (row.watchUntil === 0 || row.watchUntil > now)
}

function reapDecision(row: Pick<LeaseRow, "lastUse" | "takeover" | "watchUntil" | "dead">, now: number): ReapDecision {
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
      const made = await this.#create("headful", { takeover: false, watchUntil: 0 })
      this.#touch(made.row, agentId)
      return {
        sessionId: made.row.sessionId,
        cdpUrl: made.cdpUrl,
        mode: "headful",
        restarted: row?.dead === true,
        reopen: row?.dead ? reopen : [],
      }
    })
  }

  touch(agentId: string, tabs?: Record<string, string>): boolean {
    const row = this.deps.store.lease()
    if (!row || row.dead) return false
    this.#touch(row, agentId, tabs)
    return true
  }

  dead(sessionId: string): Promise<boolean> {
    return this.#serial(async () => {
      const row = this.deps.store.lease()
      if (!row || row.dead || row.sessionId !== sessionId) return false
      if (await (await this.deps.client()).alive(sessionId)) return false
      this.deps.store.patchLease({ dead: true })
      return true
    })
  }

  async killForDev(): Promise<string | undefined> {
    const row = this.deps.store.lease()
    if (!row) return undefined
    await (await this.deps.client()).deleteBrowser(row.sessionId).catch(() => undefined)
    return row.sessionId
  }

  setTakeover(on: boolean): void {
    const now = this.#now()
    const row = this.deps.store.lease()
    this.deps.store.patchLease(
      on
        ? { takeover: true, watchUntil: Math.max(row?.watchUntil ?? 0, now + TAKEOVER_MS), lastUse: now }
        : { takeover: false, watchUntil: 0, lastUse: now },
    )
  }

  watchUntil(until: number): void {
    const row = this.deps.store.lease()
    this.deps.store.patchLease({ watchUntil: Math.max(row?.watchUntil ?? 0, until), lastUse: this.#now() })
  }

  switchMode(mode: Mode): Promise<Switched> {
    return this.#serial(async () => {
      const { store } = this.deps
      const row = store.lease()
      if (row && row.mode === mode && !row.dead && !reapDecision(row, this.#now()).delete) {
        const urls = await store.urls()
        if (urls) return { cdpUrl: urls.cdpUrl, mode, tabs: {} }
      }
      if (row) await this.#destroy(row)
      const made = await this.#create(mode, {
        takeover: row?.takeover ?? false,
        watchUntil: row?.watchUntil ?? 0,
        tabs: row?.tabs ?? {},
      })
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
    return {
      mode: row.mode,
      tabs: Object.fromEntries(Object.entries(row.tabs).map(([agent, t]) => [agent, Object.keys(t).length])),
    }
  }

  #touch(row: LeaseRow, agentId: string, tabs?: Record<string, string>): void {
    const next = { ...row.tabs }
    if (tabs && Object.keys(tabs).length) next[agentId] = tabs
    else if (tabs) delete next[agentId]
    else next[agentId] ??= {}
    this.deps.store.patchLease({ lastUse: this.#now(), tabs: next })
  }

  async #create(
    mode: Mode,
    keep: Pick<LeaseRow, "takeover" | "watchUntil"> & { tabs?: Tabs },
  ): Promise<{ cdpUrl: string; row: LeaseRow }> {
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
      const made = await this.#retrying(() =>
        client.createBrowser({ headless: mode === "headless", profile, timeoutSeconds: KERNEL_TIMEOUT_SECONDS }),
      )
      const now = this.#now()
      const row: LeaseRow = {
        sessionId: made.sessionId,
        mode,
        createdAt: now,
        lastUse: now,
        tabs: {},
        dead: false,
        ...keep,
      }
      await store
        .putLease(row, { cdpUrl: made.cdpUrl, ...(made.liveUrl ? { liveUrl: made.liveUrl } : {}) })
        .catch(async (e) => {
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
        if (wait > MAX_RETRY_AFTER_S)
          throw new KernelError("rate_limited", `Kernel is busy. Try again in ${Math.ceil(wait)} s`, wait)
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
        this.#mark(e)
      } else if (!(e instanceof KernelError && e.kind === "not_found")) throw e
    }
    store.deleteLease()
    await wake.clear()
  }

  #mark(e: unknown): unknown {
    if (e instanceof KernelError && e.kind === "unauthorized") this.deps.store.setBroken(true)
    return e
  }
}

function reapDecisionAt(row: LeaseRow, now: number): number {
  const v = reapDecision(row, now)
  return v.delete ? now : v.at
}
