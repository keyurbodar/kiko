import { isAgentSlug } from "@kiko/protocol"
import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { userStub } from "../lib/names"

// Architecture section 7.10. The human reads and edits an agent's soul.
//   GET /api/souls/<slug>   { body, sha }
//   PUT /api/souls/<slug>   { body, expectSha }  ->  { body, sha } | 409 { error, body, sha } | 400 { error }
const PREFIX = "/api/souls/"

export async function soulRoute(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname
  if (!path.startsWith(PREFIX)) return null
  const slug = path.slice(PREFIX.length)
  if (!isAgentSlug(slug)) return Response.json({ error: "no such agent" }, { status: 404 })
  const user = await getSessionUser(request, env)
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
  const stub = userStub(env.USER, user.id)
  if (request.method === "GET") {
    const { body, sha } = await stub.soul(slug)
    return Response.json({ body, sha })
  }
  if (request.method !== "PUT") return Response.json({ error: "method not allowed" }, { status: 405 })
  // A JSON content type needs a CORS preflight, so another site cannot write here with the cookie.
  if (!request.headers.get("content-type")?.includes("application/json")) return Response.json({ error: "expected json" }, { status: 415 })
  const input = (await request.json().catch(() => null)) as { body?: unknown; expectSha?: unknown } | null
  if (typeof input?.body !== "string") return Response.json({ error: "expected a body" }, { status: 400 })
  const out = await stub.setSoul(slug, input.body, typeof input.expectSha === "string" ? input.expectSha : undefined)
  if (out.ok) return Response.json({ body: out.soul.body, sha: out.soul.sha })
  if (out.code === "conflict") {
    const now = await stub.soul(slug)
    return Response.json({ error: "changed since you opened it", body: now.body, sha: now.sha }, { status: 409 })
  }
  return Response.json({ error: out.message }, { status: 400 })
}
