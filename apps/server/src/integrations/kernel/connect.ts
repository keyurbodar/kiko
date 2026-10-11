import type { BrowserState, KernelStatus } from "@yuki/protocol"
import { sha256Hex } from "@yuki/durable/hash"
import { CredentialError, checkApiKey } from "../../user/credentials"
import { type CurlRequest, type CurlResponse, type KernelClient, KernelError, REJECTED, sdkClient } from "./client"
import { KernelLease, type LeaseInfo, MAX_TABS } from "./lease"
import type { KernelStore, LeaseRow } from "./store"

/** A message that is safe to show. Kernel's errors never carry the key. */
export function kernelErrorText(e: unknown): string {
  if (e instanceof KernelError || e instanceof CredentialError) return e.message
  return `Kernel did not answer: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300)
}

const AGENT_ID = /^[A-Za-z0-9_.:/-]{1,128}$/

/** The agent id an RPC caller names. It is only ever a key into the lease's tab map. */
export function checkAgentId(value: unknown): string {
  if (typeof value !== "string" || !AGENT_ID.test(value)) throw new KernelError("failed", "bad agent id")
  return value
}

function checkTabs(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new KernelError("failed", "bad tabs")
  const entries = Object.entries(value)
  if (entries.length > MAX_TABS) throw new KernelError("failed", "too many tabs")
  for (const [id, url] of entries) {
    if (id.length === 0 || id.length > 64 || typeof url !== "string" || url.length > 2048) throw new KernelError("failed", "bad tabs")
  }
  return Object.fromEntries(entries) as Record<string, string>
}

/** How long Watch keeps the browser open, so the reaper does not delete it under the human's eyes. */
const WATCH_MS = 10 * 60_000

/** The site a tab shows, as a hostname only: the client never sees a page URL. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname || "blank"
  } catch {
    return "blank"
  }
}

export function browserState(row: LeaseRow | undefined, switching: boolean, resolve: (agentId: string) => { slug: string; name: string }): BrowserState {
  if (!row || row.dead) return null
  const tabs = Object.entries(row.tabs).flatMap(([agentId, t]) => {
    const who = resolve(agentId)
    return Object.values(t).map((url) => ({ agent: who.name, slug: who.slug, host: hostOf(url) }))
  })
  return { mode: row.mode, tabs, takeover: row.takeover, switching, since: row.createdAt }
}

export type KernelDeps = {
  store: KernelStore
  userId: () => string
  wake: { set(at: number): Promise<void>; clear(): Promise<void> }
  clientFor?: (key: string) => KernelClient
}

export class KernelConnection {
  readonly lease: KernelLease
  private readonly clientFor: (key: string) => KernelClient

  constructor(private readonly deps: KernelDeps) {
    this.clientFor = deps.clientFor ?? sdkClient
    this.lease = new KernelLease({
      store: deps.store,
      client: () => this.client(),
      profile: () => profileName(deps.userId()),
      wake: deps.wake,
    })
  }

  status(): KernelStatus {
    const connected = this.deps.store.connected()
    return { connected, broken: connected && this.deps.store.broken(), browser: connected ? this.lease.status() : null }
  }

  async connect(apiKey: unknown): Promise<KernelStatus> {
    const key = checkApiKey(apiKey)
    try {
      await this.clientFor(key).listActive()
    } catch (e) {
      if (e instanceof KernelError && e.kind === "unauthorized") throw new KernelError("unauthorized", REJECTED)
      throw e
    }
    // A browser on the old key must not outlive it.
    await this.closeBrowser()
    const { store } = this.deps
    store.clear()
    await store.putKey(key, store.generation)
    return this.status()
  }

  async disconnect(): Promise<void> {
    await this.closeBrowser()
    this.deps.store.clear()
    await this.deps.wake.clear()
  }

  async wipe(): Promise<void> {
    if (!this.deps.store.connected()) return
    await this.lease.wipe()
  }

  async leaseFor(agentId: unknown): Promise<LeaseInfo> {
    return this.lease.lease(checkAgentId(agentId))
  }

  touch(agentId: unknown, tabs?: unknown): boolean {
    return this.lease.touch(checkAgentId(agentId), checkTabs(tabs))
  }

  release(agentId: unknown): void {
    this.lease.release(checkAgentId(agentId))
  }

  check(): { connected: boolean; takeover: boolean; tabs: Record<string, number> } {
    const row = this.deps.store.lease()
    return { connected: this.deps.store.connected(), takeover: row?.takeover ?? false, tabs: this.lease.status()?.tabs ?? {} }
  }

  markDead(agentId: unknown, sessionId: unknown): Promise<boolean> {
    checkAgentId(agentId)
    if (typeof sessionId !== "string" || !sessionId) return Promise.resolve(false)
    return this.lease.dead(sessionId)
  }

  browserState(switching: boolean, resolve: (agentId: string) => { slug: string; name: string }): BrowserState {
    return browserState(this.deps.store.connected() ? this.deps.store.lease() : undefined, switching, resolve)
  }

  takeover(): boolean {
    return this.deps.store.lease()?.takeover === true
  }

  /**
   * The live view URL for the human. A headless browser has none, so it is switched to headful first
   * (about 5 s, `onSwitching` tells the caller). `control` sets the takeover flag before the switch,
   * so agents stop at once, and the switch carries it over. Watch keeps the browser for `WATCH_MS`.
   */
  async openLink(mode: "watch" | "control", onSwitching: (on: boolean) => void): Promise<string> {
    const { store } = this.deps
    const { lease } = this
    const row = store.connected() ? store.lease() : undefined
    if (!row || row.dead) throw new KernelError("failed", "No browser is open")
    if (mode === "control") lease.setTakeover(true)
    else lease.watchUntil(Date.now() + WATCH_MS)
    if (row.mode === "headless") {
      onSwitching(true)
      try {
        await lease.switchMode("headful")
      } finally {
        onSwitching(false)
      }
    }
    const live = (await store.urls())?.liveUrl
    if (!live) throw new KernelError("failed", "Kernel gave no live view for this browser")
    if (mode === "control") return live
    const url = new URL(live)
    url.searchParams.set("readOnly", "true")
    return url.toString()
  }

  handBack(): void {
    if (this.deps.store.lease()) this.lease.setTakeover(false)
  }

  closeNow(): Promise<void> {
    return this.lease.close()
  }

  /** The current browser's Kernel session id. It is no secret: it names the browser, it does not reach it. */
  sessionId(): string | null {
    return this.deps.store.lease()?.sessionId ?? null
  }

  /** The browser's network stack: HTTP with the session's cookies and proxy. Only http and https. */
  async fetchPage(req: CurlRequest): Promise<CurlResponse> {
    if (!/^https?:\/\//i.test(req.url)) throw new KernelError("failed", "only http and https urls")
    const sessionId = await this.liveSession()
    return (await this.client()).curl(sessionId, req)
  }

  /** Writes a file onto the browser's VM. `name` is already a basename; the path is per session. */
  async putFile(name: string, bytes: Uint8Array): Promise<{ path: string }> {
    const sessionId = await this.liveSession()
    const path = `${UPLOAD_DIR}/${sessionId}/${name}`
    await (await this.client()).writeFile(sessionId, path, bytes)
    return { path }
  }

  /** Reads a file from the browser's VM. Only `/tmp` and the Kernel downloads directory. */
  async getFile(path: string): Promise<Uint8Array> {
    if (!ALLOWED_READ.test(path) || path.includes("..")) throw new KernelError("failed", "only files under /tmp or the downloads folder")
    const sessionId = await this.liveSession()
    return (await this.client()).readFile(sessionId, path)
  }

  /** Names of the files in a folder on the browser's VM. Only `/tmp` and the Kernel downloads directory. */
  async listFiles(dir: string): Promise<string[]> {
    if (!ALLOWED_READ.test(`${dir}/`) || dir.includes("..")) throw new KernelError("failed", "only folders under /tmp or the downloads folder")
    const sessionId = await this.liveSession()
    return (await this.client()).listFiles(sessionId, dir)
  }

  private async liveSession(): Promise<string> {
    const row = this.deps.store.connected() ? this.deps.store.lease() : undefined
    if (!row || row.dead) throw new KernelError("failed", "No browser is open")
    return row.sessionId
  }

  /** DEVELOPMENT ONLY. Moves the browser's clocks back, so the reaper's time is up. */
  age(ms: number): void {
    const row = this.deps.store.lease()
    if (row) this.deps.store.patchLease({ lastUse: row.lastUse - ms })
  }

  reap(): Promise<void> {
    return this.lease.reap()
  }

  private async closeBrowser(): Promise<void> {
    if (!this.deps.store.connected()) return
    // Best effort: the key may be dead already, and Kernel's own timeout is the net.
    await this.lease.close().catch(() => undefined)
  }

  private async client(): Promise<KernelClient> {
    const key = await this.deps.store.key()
    if (!key) throw new KernelError("failed", "Kernel is not connected")
    return this.clientFor(key)
  }
}

/** Where uploads land on the browser's VM, one directory per session. */
export const UPLOAD_DIR = "/tmp/kiko-uploads"
/** Kernel's downloads directory and `/tmp`, the only places `getFile` reads. */
const ALLOWED_READ = /^(\/tmp\/|\/home\/kernel\/Downloads\/)/

/** `yuki-` and 16 hex characters of the user's id hash. The name never comes from input. */
export async function profileName(userId: string): Promise<string> {
  return `yuki-${(await sha256Hex(userId)).slice(0, 16)}`
}
