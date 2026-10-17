import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { DEV, devRequest } from "../lib/dev-guard"
import { userStub } from "../lib/names"
import type { CatalogOverlay } from "../models/catalog"

// DEVELOPMENT ONLY: `verify models-sync` installs a fake remote overlay, or clears it with `{}`.
export async function devModelsRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  if (!DEV || url.pathname !== "/api/dev/user/model-overlay" || request.method !== "POST") return null
  if (!devRequest(url)) return Response.json({ error: "not found" }, { status: 404 })
  const user = await getSessionUser(request, env)
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
  const body = (await request.json().catch(() => null)) as CatalogOverlay | null
  if (!body || typeof body !== "object") return Response.json({ error: "json body required" }, { status: 400 })
  await userStub(env.USER, user.id).devModelOverlay(body)
  return Response.json({ ok: true })
}
