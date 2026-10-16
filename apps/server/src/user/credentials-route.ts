import type { Env } from "../index"
import { error, signedIn } from "../lib/route"
import { userStub } from "../lib/names"
import { KEY_REFUSED } from "./credentials-check"
import { checkApiKey, CredentialError, isProviderId } from "./credentials"

const PREFIX = "/api/credentials"
const MAX_BODY = 16_384

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

export async function credentialsRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return null
  const user = await signedIn(request, env)
  if (user instanceof Response) return user
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
  if (await stub.providerKeyRefused(provider, apiKey)) return error(400, KEY_REFUSED)
  return Response.json({ provider: await stub.connectProvider(provider, apiKey) })
}
