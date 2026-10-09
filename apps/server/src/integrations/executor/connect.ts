import type { ExecutorStatus } from "@yuki/protocol"
import { McpClient, StreamableHttpTransport, toLlmContent } from "@earendil-works/pi-mcp"
import { pendingInteraction } from "./approval"
import type { ExecutorResultBlock, ExecutorTool } from "./tools"
import { authorizeMcp, type McpOAuthState, type McpOAuthStateStore, McpOAuthProvider } from "@earendil-works/pi-mcp/oauth"
import type { Env } from "../../index"
import { userStub } from "../../lib/names"
import type { SessionLookup } from "../../router"
import { checkApiKey, CredentialError } from "../../user/credentials"
import type { ExecutorTokenStore } from "./token-store"

// Architecture section 12.1. Connects one user's Executor Cloud (v2) account. `UserDO` owns the
// one `ExecutorConnection` for its user, so every token exchange and refresh runs inside it.
//
//   start(origin)   registers yuki with Executor's sign-in server (once), and returns the
//                   authorize URL: PKCE S256, scope with `offline_access`.
//   finish(params)  the browser comes back to /api/integrations/executor/callback. The Worker
//                   checks the session and hands the code to this user's object.
//   bearer()        a fresh access token, refreshed first when it is close to expiry.
//   disconnect()    deletes every Executor row in one transaction.
//
// The fallback is a pasted API key. UNVERIFIED: that Executor accepts it as a bearer token.

export const EXECUTOR_MCP_URL = "https://v2.executor.sh/mcp"
export const EXECUTOR_CALLBACK_PATH = "/api/integrations/executor/callback"
const SCOPE = "mcp offline_access"
/** The most paused programs one user keeps a session open for. */
const MAX_HELD = 20
/** A token this close to expiry is refreshed before it is used. */
const REFRESH_EARLY_MS = 60_000

export class ExecutorError extends Error {}

/** What the authorization server sent back to the callback. */
export interface CallbackParams {
  code?: string
  state?: string
  iss?: string
  error?: string
}

/** `McpOAuthState` plus when yuki last saw a new access token. */
type StoredState = McpOAuthState & { issuedAt?: number }

/** A lowercase message that is safe to show. pi-mcp's errors carry no token. */
export function errorText(e: unknown): string {
  if (e instanceof ExecutorError || e instanceof CredentialError) return e.message
  return `executor failed: ${e instanceof Error ? e.message : String(e)}`.toLowerCase().slice(0, 300)
}

export class ExecutorConnection {
  private refreshing: Promise<void> | undefined
  /**
   * Executor v2 keeps a paused program in memory, in the MCP session that ran it, and resumes it only
   * from that session. So the session stays open until its program is resumed or Executor lets it go.
   * Lost with this object; a resume after that gets Executor's "unavailable", which the agent reports.
   */
  private readonly held = new Map<string, { client: McpClient; expiresAt: number }>()

  constructor(
    private readonly store: ExecutorTokenStore,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  /** Begins an OAuth sign-in. Returns the URL the browser opens. */
  async start(origin: string): Promise<string> {
    const generation = this.store.generation
    const redirectUrl = new URL(EXECUTOR_CALLBACK_PATH, origin).href
    let authorizeUrl: URL | undefined
    const oauth = this.provider(redirectUrl, generation, (url) => {
      authorizeUrl = url
    })
    if ((await this.store.get<string>("redirect")) !== redirectUrl) {
      // The client was registered for another callback URL, so register again.
      await oauth.invalidateCredentials("all")
      await this.store.put("redirect", redirectUrl, generation)
    } else {
      await this.forgetAttempt(generation)
    }
    const result = await authorizeMcp(oauth, { serverUrl: EXECUTOR_MCP_URL, scope: SCOPE, skipRefresh: true, fetch: this.fetcher })
    if (result !== "REDIRECT" || !authorizeUrl) throw new ExecutorError("executor did not ask for a sign-in")
    return authorizeUrl.href
  }

  /** Exchanges the code from the callback for tokens. A pasted key, if any, is replaced. */
  async finish(params: CallbackParams): Promise<ExecutorStatus> {
    const generation = this.store.generation
    const state = await this.store.get<StoredState>("oauth")
    const redirectUrl = await this.store.get<string>("redirect")
    if (!redirectUrl || !state?.oauthState || !state.codeVerifier) throw new ExecutorError("no executor sign-in is waiting")
    if (params.state !== state.oauthState) throw new ExecutorError("the sign-in state does not match")
    if (params.error) {
      await this.forgetAttempt(generation)
      throw new ExecutorError(`executor refused the sign-in: ${params.error}`.toLowerCase().slice(0, 200))
    }
    if (!params.code) throw new ExecutorError("the callback has no code")
    const oauth = this.provider(redirectUrl, generation)
    await authorizeMcp(oauth, {
      serverUrl: EXECUTOR_MCP_URL,
      scope: SCOPE,
      authorizationCode: params.code,
      iss: params.iss,
      fetch: this.fetcher,
    })
    if (generation !== this.store.generation) throw new ExecutorError("executor was disconnected during the sign-in")
    if (!(await oauth.tokens())) throw new ExecutorError("executor returned no token")
    await this.forgetAttempt(generation)
    this.store.remove("api_key")
    return this.status()
  }

  /** Stores a pasted API key in place of any OAuth grant. */
  async connectApiKey(apiKey: unknown): Promise<ExecutorStatus> {
    const key = checkApiKey(apiKey)
    this.store.clear()
    await this.store.put("api_key", key)
    return this.status()
  }

  /** Deletes every Executor row for the user. Returns how many there were. */
  disconnect(): number {
    this.refreshing = undefined
    for (const h of this.held.values()) void h.client.close().catch(() => {})
    this.held.clear()
    return this.store.clear()
  }

  /** Refreshes the OAuth tokens now. Concurrent callers share one refresh. */
  refresh(): Promise<void> {
    this.refreshing ??= this.runRefresh().finally(() => {
      this.refreshing = undefined
    })
    return this.refreshing
  }

  /** The bearer credential for Executor, refreshed first when close to expiry. Null when not connected. */
  async bearer(now = Date.now()): Promise<string | null> {
    const apiKey = await this.store.get<string>("api_key")
    if (apiKey) return apiKey
    let state = await this.store.get<StoredState>("oauth")
    if (!state?.tokens) return null
    if (state.tokens.refresh_token && state.tokensExpireAt !== undefined && state.tokensExpireAt - now < REFRESH_EARLY_MS) {
      await this.refresh()
      state = await this.store.get<StoredState>("oauth")
    }
    return state?.tokens?.access_token ?? null
  }

  /** Calls `tools/list` with the stored credential and returns the tool names. */
  async listTools(): Promise<string[]> {
    return (await this.tools()).map((t) => t.name)
  }

  /** Every tool Executor offers this user, as plain data for the agent (P7-04). */
  async tools(): Promise<ExecutorTool[]> {
    return this.withClient(async (client) =>
      (await client.listTools()).map((t) => ({
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        inputSchema: t.inputSchema,
        ...(t.annotations?.readOnlyHint ? { readOnly: true } : {}),
      })),
    )
  }

  /**
   * Calls one tool and returns its result in the shape a model reads: text and images. A resume runs
   * in the session that paused its program, and a call that pauses keeps its session open.
   */
  async call(name: string, args: Record<string, unknown>, now = Date.now()): Promise<{ content: ExecutorResultBlock[]; isError?: boolean }> {
    await this.dropExpired(now)
    const requestId = typeof args.requestId === "string" ? args.requestId : ""
    const resumed = this.held.get(requestId)
    this.held.delete(requestId)
    const client = resumed?.client ?? (await this.open())
    let keep = false
    try {
      const result = await client.callTool(name, args)
      const content = toLlmContent(result) as ExecutorResultBlock[]
      const pending = pendingInteraction(content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n"))
      if (pending) {
        this.held.set(pending.requestId, { client, expiresAt: pending.expiresAt })
        keep = true
        await this.dropOldest()
      }
      return { content, ...(result.isError ? { isError: true } : {}) }
    } finally {
      if (!keep) await client.close().catch(() => {})
    }
  }

  private async withClient<T>(run: (client: McpClient) => Promise<T>): Promise<T> {
    const client = await this.open()
    try {
      return await run(client)
    } finally {
      await client.close().catch(() => {})
    }
  }

  private async open(): Promise<McpClient> {
    if (!(await this.bearer())) throw new ExecutorError("executor is not connected")
    const client = new McpClient({ name: "Yuki", version: "0.0.0" })
    const transport = new StreamableHttpTransport({
      url: EXECUTOR_MCP_URL,
      fetch: this.fetcher,
      openGetStream: false,
      authProvider: { token: async () => (await this.bearer()) ?? undefined },
    })
    await client.connect(transport)
    return client
  }

  private async dropExpired(now: number): Promise<void> {
    for (const [id, h] of this.held) {
      if (h.expiresAt > now) continue
      this.held.delete(id)
      await h.client.close().catch(() => {})
    }
  }

  private async dropOldest(): Promise<void> {
    for (const [id, h] of this.held) {
      if (this.held.size <= MAX_HELD) return
      this.held.delete(id)
      await h.client.close().catch(() => {})
    }
  }

  async status(): Promise<ExecutorStatus> {
    const rows = this.store.count()
    if (await this.store.get<string>("api_key")) {
      return { connected: true, kind: "api_key", pending: false, expiresAt: null, issuedAt: null, refreshable: false, rows }
    }
    const state = await this.store.get<StoredState>("oauth")
    const tokens = state?.tokens
    return {
      connected: Boolean(tokens?.access_token),
      kind: tokens ? "oauth" : null,
      pending: Boolean(state?.oauthState && state.codeVerifier),
      expiresAt: tokens ? (state?.tokensExpireAt ?? null) : null,
      issuedAt: tokens ? (state?.issuedAt ?? null) : null,
      refreshable: Boolean(tokens?.refresh_token),
      rows,
    }
  }

  // Internals.

  private async runRefresh(): Promise<void> {
    const generation = this.store.generation
    const redirectUrl = await this.store.get<string>("redirect")
    const state = await this.store.get<StoredState>("oauth")
    if (!redirectUrl || !state?.tokens) throw new ExecutorError("executor is not connected")
    if (!state.tokens.refresh_token) throw new ExecutorError("executor gave no refresh token. sign in again")
    const result = await authorizeMcp(this.provider(redirectUrl, generation), { serverUrl: EXECUTOR_MCP_URL, fetch: this.fetcher })
    if (result === "REDIRECT") {
      // The refresh token was refused, so pi-mcp dropped the tokens and began a sign-in
      // that nobody will open. Drop that too. The user has to connect again.
      await this.forgetAttempt(generation)
      throw new ExecutorError("executor needs a new sign-in")
    }
  }

  /** Drops the PKCE verifier and state of an unfinished sign-in. */
  private async forgetAttempt(generation: number): Promise<void> {
    const state = await this.store.get<StoredState>("oauth")
    if (!state) return
    const { codeVerifier: _v, oauthState: _s, ...rest } = state
    await this.store.put("oauth", rest, generation)
  }

  /**
   * pi-mcp's state store for one operation. It stamps `issuedAt` whenever the access token
   * changes, so a refresh shows in the status, and it writes nothing after a disconnect.
   */
  private oauthStore(generation: number): McpOAuthStateStore {
    const inner = this.store.oauth(generation)
    return {
      load: () => inner.load(),
      save: async (next: StoredState) => {
        const previous = (await inner.load()) as StoredState | undefined
        const changed = next.tokens?.access_token !== previous?.tokens?.access_token
        await inner.save(changed && next.tokens ? { ...next, issuedAt: Date.now() } : next)
      },
    }
  }

  private provider(redirectUrl: string, generation: number, onRedirect: (url: URL) => void = () => {}): McpOAuthProvider {
    return new McpOAuthProvider({
      serverUrl: EXECUTOR_MCP_URL,
      redirectUrl,
      clientMetadata: {
        client_name: "Yuki",
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: SCOPE,
      },
      store: this.oauthStore(generation),
      onRedirect,
    })
  }
}

// The HTTP edge. The browser lands here after the Executor sign-in. The session names the
// user; the request never does. The answer is a short page, and it never holds a token.

function page(status: number, text: string): Response {
  const html = `<!doctype html><meta charset="utf-8"><title>yuki</title><p style="font:16px system-ui;margin:2rem">${text}</p>`
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } })
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export async function executorCallbackRoute(
  request: Request,
  env: Env,
  lookup: SessionLookup,
): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== EXECUTOR_CALLBACK_PATH) return null
  if (request.method !== "GET") return page(405, "method not allowed")
  // No origin check: the browser arrives by a redirect from Executor. The stored `state`,
  // which only this user's object knows, is what ties the code to the user.
  const user = await lookup(request, env)
  if (!user) return page(401, "sign in to yuki in this browser, then connect executor again")
  const q = url.searchParams
  const params: CallbackParams = {}
  for (const key of ["code", "state", "iss", "error"] as const) {
    const value = q.get(key)
    if (value !== null) params[key] = value.slice(0, 4096)
  }
  const result = await userStub(env.USER, user.id).finishExecutor(params)
  if (!result.ok) return page(400, escape(result.error))
  return page(200, "executor is connected. you can close this tab.")
}
