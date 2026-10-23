import { type AgentSlug, KIKO, KIKO_HOME_ROOM, type RunErrorKind } from "@kiko/protocol"
import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { DEV, devRequest } from "../lib/dev-guard"
import { ownerStub } from "../lib/names"

export async function devHealthRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  if (!DEV || url.pathname !== "/api/dev/user/provider-health" || request.method !== "POST") return null
  if (!devRequest(url)) return Response.json({ error: "not found" }, { status: 404 })
  const user = await getSessionUser(request, env)
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
  const body = (await request.json().catch(() => null)) as {
    refresh?: unknown
    wake?: unknown
    record?: { provider?: unknown; kind?: unknown }
    runError?: { provider?: unknown; kind?: unknown }
  } | null
  const stub = ownerStub(env.OWNER, user.id)
  const { record, runError } = body ?? {}
  if (typeof record?.provider === "string" && typeof record.kind === "string")
    await stub.userCall("recordProviderProblem", [record.provider, record.kind as RunErrorKind])
  if (
    typeof runError?.provider === "string" &&
    (runError.kind === "signed_out" || runError.kind === "network" || runError.kind === "no_key")
  ) {
    await ownerStub(env.OWNER, user.id).roomCall(KIKO_HOME_ROOM, "noProvider", [
      KIKO as AgentSlug,
      runError.provider,
      `dev-${Date.now()}`,
      [],
      [],
      runError.kind,
    ])
  }
  const refresh =
    body?.refresh === "fail" || body?.refresh === "offline" || body?.refresh === "ok" ? body.refresh : undefined
  await stub.userCall("devProviderHealth", [
    { ...(refresh ? { refresh } : {}), ...(body?.wake === true ? { wake: true } : {}) },
  ])
  return Response.json({ ok: true })
}
