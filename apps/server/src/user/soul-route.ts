import { isAgentSlug } from "@kiko/protocol"
import type { Env } from "../index"
import { error, signedIn } from "../lib/route"
import { ownerStub } from "../lib/names"

const PREFIX = "/api/souls/"

export async function soulRoute(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname
  if (!path.startsWith(PREFIX)) return null
  const user = await signedIn(request, env)
  if (user instanceof Response) return user
  const slug = path.slice(PREFIX.length)
  if (!isAgentSlug(slug)) return error(404, "no such agent")
  const stub = ownerStub(env.OWNER, user.id)
  if (request.method === "GET") {
    const { body, sha } = await stub.userCall("soul", [slug])
    return Response.json({ body, sha })
  }
  if (request.method !== "PUT") return error(405, "method not allowed")
  if (!request.headers.get("content-type")?.includes("application/json")) return error(415, "expected json")
  const input = (await request.json().catch(() => null)) as { body?: unknown; expectSha?: unknown } | null
  if (typeof input?.body !== "string") return error(400, "expected a body")
  if (typeof input.expectSha !== "string")
    return error(400, "expected expectSha, the sha of the soul this edit started from")
  const out = await stub.userCall("setSoul", [slug, input.body, input.expectSha])
  if (out.ok) return Response.json({ body: out.soul.body, sha: out.soul.sha })
  if (out.code === "conflict") {
    const now = await stub.userCall("soul", [slug])
    return Response.json({ error: "changed since you opened it", body: now.body, sha: now.sha }, { status: 409 })
  }
  return Response.json({ error: out.message }, { status: 400 })
}
