import type { Env } from "../index"
import { error, signedIn } from "../lib/route"
import { ownerStub } from "../lib/names"
import { keyRefusedText } from "./credentials-check"
import { checkApiKey, CredentialError, isProviderId } from "./credentials"

const PREFIX = "/api/credentials"
const MAX_BODY = 16_384
const CHECK = "/check"

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
  const stub = ownerStub(env.OWNER, user.id)

  if (url.pathname === PREFIX) {
    if (request.method !== "GET") return error(405, "method not allowed")
    return Response.json({ providers: await stub.userCall("listProviders", []) })
  }

  const rest = url.pathname.slice(PREFIX.length + 1)
  if (rest.endsWith(CHECK)) {
    const checked = rest.slice(0, -CHECK.length)
    if (!isProviderId(checked)) return error(400, "bad provider id")
    if (request.method !== "POST") return error(405, "method not allowed")
    const info = await stub.userCall("checkProvider", [checked])
    return info ? Response.json({ provider: info }) : error(404, "that provider is not connected")
  }
  const provider = rest
  if (!isProviderId(provider)) return error(400, "bad provider id")
  if (request.method === "DELETE")
    return Response.json({ removed: await stub.userCall("disconnectProvider", [provider]) })
  if (request.method !== "PUT") return error(405, "method not allowed")
  let apiKey: string
  try {
    apiKey = await readApiKey(request)
  } catch (e) {
    return error(400, e instanceof CredentialError ? e.message : "bad request")
  }
  const refused = await stub.userCall("providerKeyRefused", [provider, apiKey])
  if (refused !== null) return error(400, keyRefusedText(refused))
  return Response.json({ provider: await stub.userCall("connectProvider", [provider, apiKey]) })
}
