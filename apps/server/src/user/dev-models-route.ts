import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { DEV, devRequest } from "../lib/dev-guard"
import { ownerStub } from "../lib/names"
import { type CatalogOverlay, findProvider } from "../models/catalog"

export async function devModelsRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  if (!DEV || url.pathname !== "/api/dev/user/model-overlay" || request.method !== "POST") return null
  if (!devRequest(url)) return Response.json({ error: "not found" }, { status: 404 })
  const user = await getSessionUser(request, env)
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { provider?: unknown; models?: { id: string; name: string }[] } | null
  const base = typeof body?.provider === "string" ? findProvider(body.provider)?.getModels()[0] : undefined
  if (!base || !Array.isArray(body?.models)) return Response.json({ error: "provider and models required" }, { status: 400 })
  const overlay = (body.models.length ? { [base.provider]: body.models.map((m) => ({ ...base, id: m.id, name: m.name })) } : {}) as CatalogOverlay
  await ownerStub(env.OWNER, user.id).userCall("devModelOverlay", [overlay])
  return Response.json({ ok: true })
}
