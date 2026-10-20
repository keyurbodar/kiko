import { verifyToken } from "@clerk/backend"
import type { InstallEnv, InstallRequest } from "./install"
import { OAUTH_SCOPES, TOKEN_PERMISSIONS, TOKEN_TEMPLATE_URL, type Grant } from "./plan"

export type InstallOutcome =
  | { ok: true; value: { backendUrl: string; version: string } }
  | { ok: false; error: { code: string; message: string; status: number; detail?: string; accounts?: { id: string; name: string }[] } }

export type Env = InstallEnv & {
  INSTALLER: {
    idFromName(name: string): DurableObjectId
    get(id: DurableObjectId): { install(req: InstallRequest): Promise<InstallOutcome> }
  }
  CLERK_SECRET_KEY: string
  TRUSTED_ORIGINS: string
}

type InstallBody = { clerkToken?: unknown; grant?: unknown; accountId?: unknown; reset?: unknown }

export function allowedOrigin(origin: string | null, trusted: string): string | null {
  if (!origin) return null
  return trusted.split(",").map((o) => o.trim()).includes(origin) ? origin : null
}

function reply(body: unknown, status: number, origin: string | null): Response {
  const headers = new Headers({ "Content-Type": "application/json" })
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin)
    headers.set("Vary", "Origin")
  }
  return new Response(JSON.stringify(body), { status, headers })
}

/**
 * The token as Cloudflare wants it. A paste can carry spaces, quotes, or the "Bearer " of the test command
 * Cloudflare shows. A character a header cannot hold would make fetch throw, which reads as Cloudflare being
 * down, so it is dropped and Cloudflare answers that the token is invalid.
 */
export function cleanToken(raw: string): string {
  const bearer = /Bearer\s+([^\s"']+)/.exec(raw)
  return (bearer?.[1] ?? raw).replace(/[^\x21-\x7e]/g, "").replace(/^["']+|["']+$/g, "")
}

function parseGrant(value: unknown): Grant | null {
  const g = value as Partial<Record<string, unknown>> | null
  if (g?.kind === "token" && typeof g.token === "string" && cleanToken(g.token)) return { kind: "token", token: cleanToken(g.token) }
  if (g?.kind === "oauth" && typeof g.code === "string" && typeof g.verifier === "string" && typeof g.redirectUri === "string") {
    return { kind: "oauth", code: g.code, verifier: g.verifier, redirectUri: g.redirectUri }
  }
  return null
}

// The Worker only checks who is asking. The upload is built in the Installer object, which has the CPU budget for it.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const origin = allowedOrigin(request.headers.get("Origin"), env.TRUSTED_ORIGINS)
    if (request.headers.get("Origin") && !origin) return reply({ error: { code: "origin", message: "This origin is not allowed." } }, 403, null)

    if (request.method === "OPTIONS") {
      const headers = new Headers({ "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "600" })
      if (origin) {
        headers.set("Access-Control-Allow-Origin", origin)
        headers.set("Vary", "Origin")
      }
      return new Response(null, { status: 204, headers })
    }

    if (request.method === "GET" && url.pathname === "/oauth/config") {
      return reply({ clientId: env.CF_OAUTH_CLIENT_ID, authorizeUrl: "https://dash.cloudflare.com/oauth2/auth", scopes: OAUTH_SCOPES }, 200, origin)
    }
    if (request.method === "GET" && url.pathname === "/token-link") {
      // A token template URL opens the create form with the permissions ticked
      // (https://developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/).
      return reply({ url: TOKEN_TEMPLATE_URL, permissions: TOKEN_PERMISSIONS }, 200, origin)
    }

    if (request.method === "POST" && url.pathname === "/install") {
      const body = (await request.json().catch(() => null)) as InstallBody | null
      const grant = parseGrant(body?.grant)
      if (!body || typeof body.clerkToken !== "string" || !grant) {
        return reply({ error: { code: "bad_request", message: "Send clerkToken and a grant." } }, 400, origin)
      }
      let sub: string
      try {
        const claims = await verifyToken(body.clerkToken, {
          secretKey: env.CLERK_SECRET_KEY,
          jwtKey: env.CLERK_JWT_KEY || undefined,
          authorizedParties: env.TRUSTED_ORIGINS.split(",").map((o) => o.trim()),
        })
        sub = claims.sub
      } catch {
        return reply({ error: { code: "unauthorized", message: "Sign in again." } }, 401, origin)
      }
      const accountId = typeof body.accountId === "string" ? body.accountId : undefined
      const stub = env.INSTALLER.get(env.INSTALLER.idFromName(sub))
      const result = await stub.install({ sub, clerkToken: body.clerkToken, grant, accountId, ...(body.reset === "delete-existing-data" ? { reset: "delete-existing-data" as const } : {}) })
      return reply(result.ok ? result.value : { error: result.error }, result.ok ? 200 : result.error.status, origin)
    }

    return reply({ error: { code: "not_found", message: "Not found." } }, 404, origin)
  },
} satisfies ExportedHandler<Env>

