import type { ComposioStatus } from "@kiko/protocol"
import { CredentialError, checkApiKey } from "../../user/credentials"
import { count } from "../../lib/dev-guard"
import {
  type ComposioCallResult,
  ComposioError,
  type ComposioTool,
  callTool,
  catalogReadOnly,
  checkKey,
  connectedAccounts,
  createSession,
  deleteSession,
  learnedSignature,
  listTools,
  resolveToolkit as catalogToolkit,
  sessionGone,
  type Target,
} from "./client"
import {
  type Candidate,
  candidates,
  failed,
  forget,
  MULTI_EXECUTE,
  remember,
  resultJson,
  SCHEMAS,
  schemaRefs,
  SEARCH,
  succeeded,
} from "./learn"
import type { ComposioStore, StoredTarget } from "./store"

const LISTING_FRESH_MS = 10 * 60_000
const LISTING_MAX_AGE_MS = 24 * 60 * 60_000
const CONNECTED_FRESH_MS = 60_000
const CANDIDATES_MAX = 200

export function composioErrorText(e: unknown): string {
  if (e instanceof ComposioError || e instanceof CredentialError) return e.message
  return `Composio did not answer: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300)
}

export class ComposioConnection {
  private loading: Promise<ComposioTool[]> | undefined
  private readonly candidates = new Map<string, Candidate>()
  private renewing: { gone: string; next: Promise<Target> } | undefined
  private connected: { at: number; toolkits: ReadonlySet<string> | null } | undefined

  private readonly fetcher: typeof fetch

  constructor(
    private readonly store: ComposioStore,
    private readonly userId: () => Promise<string>,
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

  async connectedToolkits(now = Date.now(), fresh = false): Promise<ReadonlySet<string> | null> {
    if (!this.store.connected()) return null
    if (!fresh && this.connected && now - this.connected.at < CONNECTED_FRESH_MS) return this.connected.toolkits
    const target = await this.store.target()
    if (!target) return null
    const toolkits = await connectedAccounts(target.key, await this.userId(), this.fetcher)
    this.connected = { at: now, toolkits }
    return toolkits
  }

  async sessionId(): Promise<string | null> {
    return (await this.store.target())?.session ?? null
  }

  async resolveToolkit(app: string): Promise<string | null> {
    const target = await this.store.target()
    if (!target) return null
    return catalogToolkit(target.key, app, this.fetcher)
  }

  status(): ComposioStatus {
    return { connected: this.store.connected(), rows: this.store.count() }
  }

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
    this.connected = undefined
    this.candidates.clear()
    this.dropSession(old)
    return { status: this.status(), tools: tools.map((t) => t.name) }
  }

  disconnect(): number {
    const old = this.store.target()
    this.loading = undefined
    this.connected = undefined
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
    return this.store.learned().map((t) => ({
      name: t.slug,
      description: t.description,
      inputSchema: t.inputSchema,
      ...(t.readOnly ? { readOnly: true } : {}),
      direct: { slug: t.slug, toolkit: t.toolkit },
    }))
  }

  private async listed(now: number): Promise<ComposioTool[] | null> {
    if (!this.store.connected()) return null
    const saved = this.store.listing()
    if (saved && now - saved.at < LISTING_FRESH_MS) return saved.tools
    let loading = this.loading
    if (!loading) {
      loading = this.discover()
      const done = () => {
        if (this.loading === loading) this.loading = undefined
      }
      loading.catch((e) =>
        console.error(`composio tool list refresh failed: ${e instanceof Error ? e.message : String(e)}`),
      )
      loading.then(done, done)
      this.loading = loading
    }
    if (saved && now - saved.at <= LISTING_MAX_AGE_MS) return saved.tools
    return loading
  }

  private async discover(): Promise<ComposioTool[]> {
    const generation = this.store.generation
    const tools = await this.session((target) => listTools(target, this.fetcher), this.fetcher, "safe")
    this.store.putListing({ at: Date.now(), tools }, generation)
    return tools
  }

  async call(
    name: string,
    args: Record<string, unknown>,
    egress: typeof fetch = this.fetcher,
  ): Promise<ComposioCallResult> {
    const generation = this.store.generation
    const out = await this.session(
      (target) => callTool(target, name, args, egress),
      egress,
      this.replayable(name) ? "safe" : "unsafe",
    )
    if (out.isError && name === MULTI_EXECUTE) this.forgetFailed(failed(args, undefined), generation)
    if (out.isError || (name !== SEARCH && name !== SCHEMAS && name !== MULTI_EXECUTE)) return out
    const body = resultJson(out)
    if (!body) return out
    if (name === MULTI_EXECUTE) {
      this.forgetFailed(failed(args, body), generation)
      const learned = this.store.learned()
      const listed = this.listedNames()
      const used = succeeded(args, body).flatMap((slug) =>
        listed.has(slug) ? [] : (this.candidates.get(slug) ?? learned.find((t) => t.slug === slug) ?? []),
      )
      if (used.length) this.store.putLearned(remember(learned, used, Date.now()), generation)
      for (const c of used) if (!learned.some((t) => t.slug === c.slug)) this.classify(c.slug, generation, egress)
      return out
    }
    for (const c of candidates(body)) {
      this.candidates.delete(c.slug)
      this.candidates.set(c.slug, c)
    }
    const missing = schemaRefs(body)
    if (missing.length) this.loadSchemas(missing, generation, egress)
    for (const slug of this.candidates.keys()) {
      if (this.candidates.size <= CANDIDATES_MAX) break
      this.candidates.delete(slug)
    }
    return out
  }

  private listedNames(): ReadonlySet<string> {
    return new Set((this.store.listing()?.tools ?? []).map((t) => t.name))
  }

  private loadSchemas(slugs: string[], generation: number, egress: typeof fetch): void {
    const called = this.session((target) => callTool(target, SCHEMAS, { tool_slugs: slugs }, egress), egress, "safe")
    const work = called.then((out) => {
      const body = resultJson(out)
      if (!body) return
      for (const c of candidates(body)) {
        this.candidates.delete(c.slug)
        this.candidates.set(c.slug, c)
      }
      if (generation !== this.store.generation) return
      for (const slug of this.candidates.keys()) {
        if (this.candidates.size <= CANDIDATES_MAX) break
        this.candidates.delete(slug)
      }
    })
    this.waitUntil(work.catch(() => undefined))
  }

  private classify(slug: string, generation: number, egress: typeof fetch): void {
    const work = this.store.target().then(async (target) => {
      if (!target) return
      const readOnly = await catalogReadOnly(target.key, slug, egress)
      this.store.putLearned(
        this.store.learned().map((t) => (t.slug === slug ? { ...t, readOnly } : t)),
        generation,
      )
    })
    this.waitUntil(work.catch(() => undefined))
  }

  private forgetFailed(slugs: string[], generation: number): void {
    const learned = this.store.learned()
    const kept = forget(learned, slugs)
    if (kept.length !== learned.length) this.store.putLearned(kept, generation)
  }

  private replayable(name: string): boolean {
    if (name === SEARCH || name === SCHEMAS) return true
    return (
      (this.store.listing()?.tools ?? []).some((t) => t.name === name && t.readOnly === true) ||
      this.store.learned().some((t) => t.slug === name && t.readOnly === true)
    )
  }

  private async session<T>(
    work: (target: Target) => Promise<T>,
    egress: typeof fetch,
    replay: "safe" | "unsafe",
  ): Promise<T> {
    const target = await this.store.target()
    if (!target) throw new ComposioError({ message: "Composio is not connected" })
    try {
      return await work(target)
    } catch (e) {
      if (replay === "unsafe" || !sessionGone(e)) throw e
      return work(await this.renew(target.key, target.session, egress))
    }
  }

  private renew(key: string, gone: string, egress: typeof fetch): Promise<Target> {
    if (this.renewing?.gone === gone) return this.renewing.next
    const generation = this.store.generation
    const next = (async () => {
      const session = await createSession(key, await this.userId(), egress)
      if (generation !== this.store.generation) {
        this.dropSession(Promise.resolve({ key, url: session.url, session: session.id }))
        throw new ComposioError({ message: "Composio is not connected" })
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
