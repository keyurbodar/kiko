import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { userStub } from "../lib/names"
import { originAllowed, type SessionLookup } from "../router"
import { checkApiKey, CredentialError, isProviderId } from "./credentials"

// The HTTP edge for provider credentials. Architecture section 11.2.
//
//   GET    /api/credentials             -> { providers: ProviderInfo[] }
//   PUT    /api/credentials/<provider>  { apiKey } -> { provider: ProviderInfo }
//   DELETE /api/credentials/<provider>  -> { removed: boolean }
//
// A key goes in and never comes back out. Every answer holds only the provider id, the
// kind, and the last four characters. A request body is never logged or echoed.

const PREFIX = "/api/credentials"
const MAX_BODY = 16_384

function error(status: number, message: string): Response {
  return Response.json({ error: message }, { status })
}

async function readApiKey(request: Request): Promise<string> {
  if (!request.headers.get("content-type")?.includes("json")) throw new CredentialError("expected a json body")
  const text = await request.text()
  if (text.length > MAX_BODY) throw new CredentialError("body is too large")
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new CredentialError("body is not json")
  }
  return checkApiKey((body as { apiKey?: unknown } | null)?.apiKey)
}

/** Answers `/api/credentials` and below. Returns null for every other path. */
export async function credentialsRoute(
  request: Request,
  env: Env,
  lookup: SessionLookup = getSessionUser,
): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return null
  if (!originAllowed(request, url, env)) return error(403, "forbidden origin")
  const user = await lookup(request, env)
  if (!user) return error(401, "unauthorized")
  const stub = userStub(env.USER, user.id)

  if (url.pathname === PREFIX) {
    if (request.method !== "GET") return error(405, "method not allowed")
    return Response.json({ providers: await stub.listProviders() })
  }

  const provider = url.pathname.slice(PREFIX.length + 1)
  if (!isProviderId(provider)) return error(400, "bad provider id")
  if (request.method === "DELETE") return Response.json({ removed: await stub.disconnectProvider(provider) })
  if (request.method !== "PUT") return error(405, "method not allowed")
  let apiKey: string
  try {
    apiKey = await readApiKey(request)
  } catch (e) {
    return error(400, e instanceof CredentialError ? e.message : "bad request")
  }
  return Response.json({ provider: await stub.connectProvider(provider, apiKey) })
}
