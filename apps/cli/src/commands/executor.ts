import { CliError, type Context } from "../main"

const issuer = "https://signin.executor.sh"
const mcp = "https://executor.sh/mcp"

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new CliError(`${url} returned ${res.status}`)
  return res.json()
}

// kiko executor discover: public metadata only, needs no account.
async function discover(ctx: Context) {
  const resource = (await getJson("https://executor.sh/.well-known/oauth-protected-resource/mcp")) as { authorization_servers?: string[] }
  const meta = (await getJson(`${issuer}/.well-known/oauth-authorization-server`)) as Record<string, unknown>
  const out = {
    resource: mcp,
    authorizationServers: resource.authorization_servers,
    registrationEndpoint: meta.registration_endpoint,
    pkce: meta.code_challenge_methods_supported,
    authMethods: meta.token_endpoint_auth_methods_supported,
    grants: meta.grant_types_supported,
    scopes: meta.scopes_supported,
  }
  console.log(ctx.json ? JSON.stringify(out) : Object.entries(out).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n"))
}

// kiko executor probe: asks the Worker to call tools/list on Executor with its stored token.
async function probe(ctx: Context) {
  const base = ctx.url.endsWith("/") ? ctx.url : `${ctx.url}/`
  const url = new URL("api/experiments/executor-oauth/probe", base)
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30000) })
  } catch (e) {
    throw new CliError(`probe failed: cannot reach ${url.origin} (${e instanceof Error ? e.message : e})`)
  }
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean
    tools?: string[]
    error?: string
    startUrl?: string
    accessTokenLifetimeSeconds?: number | null
    refreshTokenReceived?: boolean
  } | null
  if (res.status === 401 && body?.startUrl) throw new CliError(`not signed in to executor. open ${body.startUrl} in a browser, then run probe again`)
  if (!body?.ok || !body.tools) throw new CliError(`probe failed: ${body?.error ?? res.status}`)
  if (ctx.json) console.log(JSON.stringify(body))
  else {
    for (const name of body.tools) console.log(name)
    console.error(`tools: ${body.tools.length}, lifetime: ${body.accessTokenLifetimeSeconds ?? "unknown"}s, refresh token: ${body.refreshTokenReceived ? "yes" : "no"}`)
  }
}

export async function executor(ctx: Context): Promise<void> {
  const [sub] = ctx.args
  if (sub === "probe") return probe(ctx)
  if (sub === "discover") return discover(ctx)
  throw new CliError("usage: kiko executor <probe | discover>")
}
