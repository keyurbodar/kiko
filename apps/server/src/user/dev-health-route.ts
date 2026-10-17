import { type AgentSlug, KIKO, KIKO_HOME_ROOM, type RunErrorKind } from "@kiko/protocol"
import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { DEV, devRequest } from "../lib/dev-guard"
import { roomStub, userStub } from "../lib/names"

// DEVELOPMENT ONLY: `verify provider-health` makes the fake sign-in's token refresh fail or work, and runs the six-hourly refresh now.
// `record` stores a provider problem as a failed run would, and `runError` writes the line a run that could not start leaves in Kiko's chat.
export async function devHealthRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  if (!DEV || url.pathname !== "/api/dev/user/provider-health" || request.method !== "POST") return null
  if (!devRequest(url)) return Response.json({ error: "not found" }, { status: 404 })
  const user = await getSessionUser(request, env)
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { refresh?: unknown; wake?: unknown; record?: { provider?: unknown; kind?: unknown }; runError?: { provider?: unknown; kind?: unknown } } | null
  const stub = userStub(env.USER, user.id)
  const { record, runError } = body ?? {}
  if (typeof record?.provider === "string" && typeof record.kind === "string") await stub.recordProviderProblem(record.provider, record.kind as RunErrorKind)
  if (typeof runError?.provider === "string" && (runError.kind === "signed_out" || runError.kind === "network" || runError.kind === "no_key")) {
    await roomStub(env.ROOM, user.id, KIKO_HOME_ROOM).noProvider(KIKO as AgentSlug, runError.provider, `dev-${Date.now()}`, [], [], runError.kind)
  }
  const refresh = body?.refresh === "fail" || body?.refresh === "offline" || body?.refresh === "ok" ? body.refresh : undefined
  await stub.devProviderHealth({ ...(refresh ? { refresh } : {}), ...(body?.wake === true ? { wake: true } : {}) })
  return Response.json({ ok: true })
}
