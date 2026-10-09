import { McpClient, StreamableHttpTransport } from "@earendil-works/pi-mcp"
import {
  adaptOAuthProvider,
  authorizeMcp,
  McpOAuthAuthorizationRequiredError,
  McpOAuthProvider,
  MemoryOAuthStateStore,
} from "@earendil-works/pi-mcp/oauth"

// Experiment 8. Not production code. State lives in one isolate's memory so a Worker restart
// forgets it. The real flow keeps this state in UserDO, encrypted (architecture section 12.1).
// No token is ever returned or logged. The probe reports tool names, lifetime, and refresh presence.

export const executorMcpUrl = "https://v2.executor.sh/mcp"
export const executorOAuthPrefix = "/api/experiments/executor-oauth"
const store = new MemoryOAuthStateStore()

function provider(origin: string, onRedirect: (url: URL) => void) {
  return new McpOAuthProvider({
    serverUrl: executorMcpUrl,
    redirectUrl: `${origin}${executorOAuthPrefix}/callback`,
    clientMetadata: {
      client_name: "yuki",
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "mcp offline_access",
    },
    store,
    onRedirect,
  })
}

async function listTools(oauth: McpOAuthProvider) {
  const client = new McpClient({ name: "yuki", version: "0.0.0" })
  const transport = new StreamableHttpTransport({
    url: executorMcpUrl,
    authProvider: adaptOAuthProvider(oauth),
    openGetStream: false,
  })
  try {
    await client.connect(transport)
    return (await client.listTools()).map((t) => t.name)
  } finally {
    await client.close().catch(() => {})
  }
}

async function report(oauth: McpOAuthProvider) {
  const tools = await listTools(oauth)
  const tokens = await oauth.tokens()
  const state = store.load()
  return {
    ok: true,
    tools,
    accessTokenLifetimeSeconds: tokens?.expires_in ?? null,
    accessTokenExpiresAt: state?.tokensExpireAt ?? null,
    refreshTokenReceived: Boolean(tokens?.refresh_token),
    scope: tokens?.scope ?? null,
  }
}

export async function executorOAuth(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const route = url.pathname.slice(executorOAuthPrefix.length)
  const startUrl = `${url.origin}${executorOAuthPrefix}/start`
  let redirect: URL | undefined
  const oauth = provider(url.origin, (u) => {
    redirect = u
  })
  try {
    if (route === "/start") {
      try {
        return Response.json(await report(oauth))
      } catch (e) {
        if (!(e instanceof McpOAuthAuthorizationRequiredError) || !redirect) throw e
        return Response.redirect(redirect.toString(), 302)
      }
    }
    if (route === "/callback") {
      const code = url.searchParams.get("code")
      const err = url.searchParams.get("error")
      if (err) return Response.json({ ok: false, error: err, description: url.searchParams.get("error_description") }, { status: 400 })
      if (!code) return Response.json({ ok: false, error: "missing code" }, { status: 400 })
      if (url.searchParams.get("state") !== (await oauth.state())) return Response.json({ ok: false, error: "bad state" }, { status: 400 })
      await authorizeMcp(oauth, { serverUrl: executorMcpUrl, authorizationCode: code, iss: url.searchParams.get("iss") ?? undefined })
      return Response.json(await report(oauth))
    }
    if (route === "/probe") {
      if (!(await oauth.tokens())) return Response.json({ ok: false, error: "not signed in", startUrl }, { status: 401 })
      return Response.json(await report(oauth))
    }
    return Response.json({ ok: false, error: "not found" }, { status: 404 })
  } catch (e) {
    if (e instanceof McpOAuthAuthorizationRequiredError) return Response.json({ ok: false, error: "not signed in", startUrl }, { status: 401 })
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 502 })
  }
}
