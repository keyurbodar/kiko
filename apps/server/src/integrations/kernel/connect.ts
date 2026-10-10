import type { KernelStatus } from "@yuki/protocol"
import { sha256Hex } from "@yuki/durable/hash"
import { CredentialError, checkApiKey } from "../../user/credentials"
import { type KernelClient, KernelError, REJECTED, sdkClient } from "./client"
import { KernelLease, type LeaseInfo, MAX_TABS } from "./lease"
import type { KernelStore } from "./store"

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

/** The tabs an agent reports: at most `MAX_TABS`, tab id to last URL. */
export function checkTabs(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new KernelError("failed", "bad tabs")
  const entries = Object.entries(value)
  if (entries.length > MAX_TABS) throw new KernelError("failed", "too many tabs")
  for (const [id, url] of entries) {
    if (id.length === 0 || id.length > 64 || typeof url !== "string" || url.length > 2048) throw new KernelError("failed", "bad tabs")
  }
  return Object.fromEntries(entries) as Record<string, string>
}

export type KernelDeps = {
  store: KernelStore
  userId: string
  wake: { set(at: number): Promise<void>; clear(): Promise<void> }
  /** Replaces the Kernel client, for tests and for the development fixture. */
  clientFor?: (key: string) => KernelClient
}

/** One user's Kernel connection. `UserDO` owns the one instance for its user. */
export class KernelConnection {
  readonly lease: KernelLease
  private readonly clientFor: (key: string) => KernelClient

  constructor(private readonly deps: KernelDeps) {
    this.clientFor = deps.clientFor ?? ((key) => sdkClient(key))
    this.lease = new KernelLease({
      store: deps.store,
      client: () => this.client(),
      profile: () => profileName(deps.userId),
      wake: deps.wake,
    })
  }

  status(): KernelStatus {
    const connected = this.deps.store.connected()
    return { connected, broken: connected && this.deps.store.broken(), browser: connected ? this.lease.status() : null }
  }

  /** Checks the key with one list of active browsers, then replaces any stored key. A rejected key stores nothing. */
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

  /** Account deletion: the browser and the profile. Nothing to do without a key. */
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

  /** The agent saw its socket die. */
  markDead(agentId: unknown): void {
    checkAgentId(agentId)
    this.lease.dead()
  }

  /** The current browser's Kernel session id. It is no secret: it names the browser, it does not reach it. */
  sessionId(): string | null {
    return this.deps.store.lease()?.sessionId ?? null
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

/** `yuki-` and 16 hex characters of the user's id hash. The name never comes from input. */
export async function profileName(userId: string): Promise<string> {
  return `yuki-${(await sha256Hex(userId)).slice(0, 16)}`
}
