import type { ComposioStatus } from "@yuki/protocol"
import { CredentialError, checkApiKey } from "../../user/credentials"
import { count } from "../../lib/dev-stats"
import { type ComposioCallResult, ComposioError, type ComposioTool, callTool, listTools } from "./client"
import type { ComposioStore } from "./store"

/** A listing older than this is still served, and a new one loads behind it. */
const LISTING_FRESH_MS = 10 * 60_000

/** A message that is safe to show. Composio's errors never carry the key. */
export function composioErrorText(e: unknown): string {
  if (e instanceof ComposioError || e instanceof CredentialError) return e.message
  return `Composio did not answer: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300)
}

/** One user's Composio connection. `UserDO` owns the one instance for its user. */
export class ComposioConnection {
  private listing: { at: number; tools: Promise<ComposioTool[]> } | undefined

  private readonly fetcher: typeof fetch

  constructor(
    private readonly store: ComposioStore,
    fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {
    this.fetcher = async (input, init) => {
      const t = performance.now()
      try {
        return await fetcher(input, init)
      } finally {
        count("composio.http")
        count("composio.httpMs", Math.round(performance.now() - t))
      }
    }
  }

  status(): ComposioStatus {
    return { connected: this.store.connected(), rows: this.store.count() }
  }

  /** Validates the key with one `tools/list`, then replaces any stored key. A rejected key stores nothing. */
  async connect(apiKey: unknown): Promise<{ status: ComposioStatus; tools: string[] }> {
    const key = checkApiKey(apiKey)
    const tools = await listTools(key, this.fetcher)
    this.store.clear()
    const generation = this.store.generation
    await this.store.putKey(key, generation)
    this.store.putListing({ at: Date.now(), tools }, generation)
    this.listing = { at: Date.now(), tools: Promise.resolve(tools) }
    return { status: this.status(), tools: tools.map((t) => t.name) }
  }

  disconnect(): number {
    this.listing = undefined
    return this.store.clear()
  }

  /**
   * The tools agents get, or null when no key is stored. A run waits on Composio only when no
   * listing exists yet: an old one is served while a new one loads.
   */
  async tools(now = Date.now()): Promise<ComposioTool[] | null> {
    if (!this.store.connected()) return null
    const saved = this.store.listing()
    const kept = this.listing ?? (saved ? { at: saved.at, tools: Promise.resolve(saved.tools) } : undefined)
    if (kept && now - kept.at < LISTING_FRESH_MS) return kept.tools
    const loading = this.discover()
    const next = { at: now, tools: loading }
    this.listing = next
    loading.catch(() => {
      if (this.listing === next) this.listing = kept
    })
    return kept ? kept.tools : loading
  }

  private async discover(): Promise<ComposioTool[]> {
    const generation = this.store.generation
    const key = await this.key()
    const tools = await listTools(key, this.fetcher)
    this.store.putListing({ at: Date.now(), tools }, generation)
    return tools
  }

  async call(name: string, args: Record<string, unknown>): Promise<ComposioCallResult> {
    return callTool(await this.key(), name, args, this.fetcher)
  }

  private async key(): Promise<string> {
    const key = await this.store.key()
    if (!key) throw new ComposioError("Composio is not connected")
    return key
  }
}
