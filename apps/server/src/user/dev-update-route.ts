import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { DEV, devRequest } from "../lib/dev-guard"
import { ownerStub } from "../lib/names"

// DEVELOPMENT ONLY: `verify update` points the update at a local release and a fake Cloudflare.
export async function devUpdateRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  if (!DEV || url.pathname !== "/api/dev/user/update-config" || request.method !== "POST") return null
  if (!devRequest(url)) return Response.json({ error: "not found" }, { status: 404 })
  const user = await getSessionUser(request, env)
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return Response.json({ error: "json body required" }, { status: 400 })
  await ownerStub(env.OWNER, user.id).devUpdateConfig(body)
  return Response.json({ ok: true })
}
