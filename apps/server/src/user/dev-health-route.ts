import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { DEV, devRequest } from "../lib/dev-guard"
import { userStub } from "../lib/names"

// DEVELOPMENT ONLY: `verify provider-health` makes the fake sign-in's token refresh fail or work, and runs the six-hourly refresh now.
export async function devHealthRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  if (!DEV || url.pathname !== "/api/dev/user/provider-health" || request.method !== "POST") return null
  if (!devRequest(url)) return Response.json({ error: "not found" }, { status: 404 })
  const user = await getSessionUser(request, env)
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { refresh?: unknown; wake?: unknown } | null
  const refresh = body?.refresh === "fail" || body?.refresh === "ok" ? body.refresh : undefined
  await userStub(env.USER, user.id).devProviderHealth({ ...(refresh ? { refresh } : {}), ...(body?.wake === true ? { wake: true } : {}) })
  return Response.json({ ok: true })
}
