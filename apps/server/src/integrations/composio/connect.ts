import type { ComposioStatus } from "@yuki/protocol"
import { CredentialError, checkApiKey } from "../../user/credentials"
import { count } from "../../lib/dev-stats"
import { type ComposioCallResult, ComposioError, type ComposioTool, callTool, catalogReadOnly, checkDeveloperKey, learnedSignature, listTools } from "./client"
import { type Candidate, candidates, failed, forget, MULTI_EXECUTE, remember, resultJson, SCHEMAS, SEARCH, succeeded } from "./learn"
import type { ComposioStore } from "./store"

/** A listing older than this is still served, and a new one loads behind it. */
const LISTING_FRESH_MS = 10 * 60_000
/** Schemas seen in searches, kept until a run uses one. Oldest go first. */
const CANDIDATES_MAX = 200

/** A message that is safe to show. Composio's errors never carry the key. */
export function composioErrorText(e: unknown): string {
  if (e instanceof ComposioError || e instanceof CredentialError) return e.message
  return `Composio did not answer: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300)
}

/** One user's Composio connection. `UserDO` owns the one instance for its user. */
export class ComposioConnection {
  private listing: { at: number; tools: Promise<ComposioTool[]> } | undefined
  private readonly candidates = new Map<string, Candidate>()

  private readonly fetcher: typeof fetch

  /** `waitUntil` keeps the object alive for catalog lookups that run behind a call. */
  constructor(
    private readonly store: ComposioStore,
    fetcher: typeof fetch = (input, init) => fetch(input, init),
    private readonly waitUntil: (work: Promise<unknown>) => void = () => undefined,
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
    return { connected: this.store.connected(), rows: this.store.count(), developer: this.store.hasDeveloperKey() }
  }

  /** Validates the key with one `tools/list`, then replaces any stored key. A rejected key stores nothing. */
  async connect(apiKey: unknown): Promise<{ status: ComposioStatus; tools: string[] }> {
    const key = checkApiKey(apiKey)
    const tools = await listTools(key, this.fetcher)
    const developer = await this.store.developerKey()
    this.store.clear()
    const generation = this.store.generation
    await this.store.putKey(key, generation)
    if (developer) await this.store.putDeveloperKey(developer, generation)
    this.store.putListing({ at: Date.now(), tools }, generation)
    this.listing = { at: Date.now(), tools: Promise.resolve(tools) }
    return { status: this.status(), tools: tools.map((t) => t.name) }
  }

  /**
   * Stores the developer key once Composio accepts it, or deletes it with null. A rejected key
   * stores nothing. Learned tools with no class yet are classified behind the answer.
   */
  async setDeveloperKey(value: unknown): Promise<ComposioStatus> {
    if (!this.store.connected()) throw new ComposioError("Composio is not connected")
    const generation = this.store.generation
    if (value === null) {
      await this.store.putDeveloperKey(null, generation)
      return this.status()
    }
    const key = checkApiKey(value)
    await checkDeveloperKey(key, this.fetcher)
    await this.store.putDeveloperKey(key, generation)
    for (const t of this.store.learned()) if (t.readOnly === undefined) this.classify(t.slug, generation)
    return this.status()
  }

  disconnect(): number {
    this.listing = undefined
    this.candidates.clear()
    return this.store.clear()
  }

  /** The tools agents get, or null when no key is stored: the listing, then the learned direct tools. */
  async tools(now = Date.now()): Promise<ComposioTool[] | null> {
    const listed = await this.listed(now)
    if (!listed) return null
    return [...listed, ...this.learnedTools()]
  }

  /** Cheap: no call to Composio. Null when no key is stored. */
  signature(): string | null {
    return this.store.connected() ? learnedSignature(this.learnedTools()) : null
  }

  private learnedTools(): ComposioTool[] {
    return this.store.learned().map((t) => ({ name: t.slug, description: t.description, inputSchema: t.inputSchema, ...(t.readOnly ? { readOnly: true } : {}), direct: { slug: t.slug, toolkit: t.toolkit } }))
  }

  /** A run waits on Composio only when no listing exists yet: an old one is served while a new one loads. */
  private async listed(now: number): Promise<ComposioTool[] | null> {
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

  /** Every agent call passes here, so this is where direct tools are learned. */
  async call(name: string, args: Record<string, unknown>): Promise<ComposioCallResult> {
    const generation = this.store.generation
    const out = await callTool(await this.key(), name, args, this.fetcher)
    if (out.isError && name === MULTI_EXECUTE) this.forgetFailed(failed(args, undefined), generation)
    if (out.isError || (name !== SEARCH && name !== SCHEMAS && name !== MULTI_EXECUTE)) return out
    const body = resultJson(out)
    if (!body) return out
    if (name === MULTI_EXECUTE) {
      this.forgetFailed(failed(args, body), generation)
      const learned = this.store.learned()
      const used = succeeded(args, body).flatMap((slug) => this.candidates.get(slug) ?? learned.find((t) => t.slug === slug) ?? [])
      if (used.length) this.store.putLearned(remember(learned, used, Date.now()), generation)
      for (const c of used) if (!learned.some((t) => t.slug === c.slug)) this.classify(c.slug, generation)
      return out
    }
    for (const c of candidates(body)) {
      this.candidates.delete(c.slug)
      this.candidates.set(c.slug, c)
    }
    for (const slug of this.candidates.keys()) {
      if (this.candidates.size <= CANDIDATES_MAX) break
      this.candidates.delete(slug)
    }
    return out
  }

  /** Without a developer key the tool stays `external`. */
  private classify(slug: string, generation: number): void {
    const work = this.store.developerKey().then(async (key) => {
      if (!key) return
      const readOnly = await catalogReadOnly(key, slug, this.fetcher)
      this.store.putLearned(this.store.learned().map((t) => (t.slug === slug ? { ...t, readOnly } : t)), generation)
    })
    this.waitUntil(work.catch(() => undefined))
  }

  private forgetFailed(slugs: string[], generation: number): void {
    const learned = this.store.learned()
    const kept = forget(learned, slugs)
    if (kept.length !== learned.length) this.store.putLearned(kept, generation)
  }

  private async key(): Promise<string> {
    const key = await this.store.key()
    if (!key) throw new ComposioError("Composio is not connected")
    return key
  }
}
