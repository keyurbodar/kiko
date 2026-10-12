import type { ComposioStatus } from "@yuki/protocol"
import { CredentialError, checkApiKey } from "../../user/credentials"
import { count } from "../../lib/dev-guard"
import { type ComposioCallResult, ComposioError, type ComposioTool, callTool, catalogReadOnly, checkKey, createSession, deleteSession, learnedSignature, listTools, sessionGone, type Target } from "./client"
import { type Candidate, candidates, failed, forget, MULTI_EXECUTE, remember, resultJson, SCHEMAS, SEARCH, succeeded } from "./learn"
import type { ComposioStore, StoredTarget } from "./store"

const LISTING_FRESH_MS = 10 * 60_000
const CANDIDATES_MAX = 200

export function composioErrorText(e: unknown): string {
  if (e instanceof ComposioError || e instanceof CredentialError) return e.message
  return `Composio did not answer: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300)
}

export class ComposioConnection {
  private loading: Promise<ComposioTool[]> | undefined
  private readonly candidates = new Map<string, Candidate>()
  private renewing: { gone: string; next: Promise<Target> } | undefined

  private readonly fetcher: typeof fetch

  constructor(
    private readonly store: ComposioStore,
    private readonly userId: () => Promise<string>,
    // check-rules: allow egress Composio calls run in UserDO, which gets its own invocation per RPC. UNVERIFIED until G01: that they stay outside an agent run's 50 subrequests (architecture 17.3)
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

  async sessionId(): Promise<string | null> {
    return (await this.store.target())?.session ?? null
  }

  status(): ComposioStatus {
    return { connected: this.store.connected(), rows: this.store.count() }
  }

  /** A rejected key stores nothing. The previous session is deleted behind the answer. */
  async connect(apiKey: unknown): Promise<{ status: ComposioStatus; tools: string[] }> {
    const key = checkApiKey(apiKey)
    await checkKey(key, this.fetcher)
    const session = await createSession(key, await this.userId(), this.fetcher)
    const tools = await listTools({ key, url: session.url }, this.fetcher).catch((e) => {
      this.dropSession(Promise.resolve({ key, url: session.url, session: session.id }))
      throw e
    })
    const old = this.store.target()
    this.store.clear()
    const generation = this.store.generation
    await this.store.putKey(key, session, generation)
    this.store.putListing({ at: Date.now(), tools }, generation)
    this.loading = undefined
    this.candidates.clear()
    this.dropSession(old)
    return { status: this.status(), tools: tools.map((t) => t.name) }
  }

  disconnect(): number {
    const old = this.store.target()
    this.loading = undefined
    this.candidates.clear()
    const removed = this.store.clear()
    this.dropSession(old)
    return removed
  }

  private dropSession(stored: Promise<StoredTarget | undefined>): void {
    this.waitUntil(stored.then((t) => t && deleteSession(t.key, t.session, this.fetcher)).catch(() => undefined))
  }

  async tools(now = Date.now()): Promise<ComposioTool[] | null> {
    const listed = await this.listed(now)
    if (!listed) return null
    return [...listed, ...this.learnedTools()]
  }

  signature(): string | null {
    return this.store.connected() ? learnedSignature(this.learnedTools()) : null
  }

  private learnedTools(): ComposioTool[] {
    return this.store.learned().map((t) => ({ name: t.slug, description: t.description, inputSchema: t.inputSchema, ...(t.readOnly ? { readOnly: true } : {}), direct: { slug: t.slug, toolkit: t.toolkit } }))
  }

  /** An old listing is served while a new one loads behind it. */
  private async listed(now: number): Promise<ComposioTool[] | null> {
    if (!this.store.connected()) return null
    const saved = this.store.listing()
    if (saved && now - saved.at < LISTING_FRESH_MS) return saved.tools
    if (!this.loading) {
      const loading = this.discover()
      const done = () => {
        if (this.loading === loading) this.loading = undefined
      }
      loading.then(done, done)
      this.loading = loading
    }
    return saved ? saved.tools : this.loading
  }

  private async discover(): Promise<ComposioTool[]> {
    const generation = this.store.generation
    const tools = await this.session((target) => listTools(target, this.fetcher))
    this.store.putListing({ at: Date.now(), tools }, generation)
    return tools
  }

  /** Every agent call passes here, so this is where direct tools are learned. */
  async call(name: string, args: Record<string, unknown>): Promise<ComposioCallResult> {
    const generation = this.store.generation
    const out = await this.session((target) => callTool(target, name, args, this.fetcher))
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

  /** When the lookup fails, the tool stays `external`. */
  private classify(slug: string, generation: number): void {
    const work = this.store.target().then(async (target) => {
      if (!target) return
      const readOnly = await catalogReadOnly(target.key, slug, this.fetcher)
      this.store.putLearned(this.store.learned().map((t) => (t.slug === slug ? { ...t, readOnly } : t)), generation)
    })
    this.waitUntil(work.catch(() => undefined))
  }

  private forgetFailed(slugs: string[], generation: number): void {
    const learned = this.store.learned()
    const kept = forget(learned, slugs)
    if (kept.length !== learned.length) this.store.putLearned(kept, generation)
  }

  /** When Composio says the session is gone, makes a new one and runs `work` once more. */
  private async session<T>(work: (target: Target) => Promise<T>): Promise<T> {
    const target = await this.store.target()
    if (!target) throw new ComposioError("Composio is not connected")
    try {
      return await work(target)
    } catch (e) {
      if (!sessionGone(e)) throw e
      return work(await this.renew(target.key, target.session))
    }
  }

  /** One new session for any number of calls that found `gone` gone. */
  private renew(key: string, gone: string): Promise<Target> {
    if (this.renewing?.gone === gone) return this.renewing.next
    const generation = this.store.generation
    const next = (async () => {
      const session = await createSession(key, await this.userId(), this.fetcher)
      if (generation !== this.store.generation) {
        this.dropSession(Promise.resolve({ key, url: session.url, session: session.id }))
        throw new ComposioError("Composio is not connected")
      }
      this.store.putSession(session, generation)
      return { key, url: session.url }
    })()
    this.renewing = { gone, next }
    next.catch(() => {
      if (this.renewing?.next === next) this.renewing = undefined
    })
    return next
  }
}
