import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { devRequest, DEV } from "../lib/dev-guard"
import { ownerStub } from "../lib/names"

export async function devBrowserRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  const share = url.pathname === "/api/dev/user/browser-link"
  if (!DEV || (url.pathname !== "/api/dev/user/browser-tabs" && !share) || request.method !== "POST") return null
  if (!devRequest(url)) return Response.json({ error: "not found" }, { status: 404 })
  const user = await getSessionUser(request, env)
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const agentId = body?.agentId
  if (typeof agentId !== "string") return Response.json({ error: "agentId required" }, { status: 400 })
  try {
    const stub = ownerStub(env.OWNER, user.id)
    if (share) {
      const roomId = body?.roomId
      const reason = body?.reason
      const mode = body?.mode === "control" ? "control" : "watch"
      if (typeof roomId !== "string" || (reason !== undefined && typeof reason !== "string")) return Response.json({ error: "roomId required" }, { status: 400 })
      const out = await stub.userCall("browserLive", [agentId, roomId, mode, reason])
      return Response.json(out.ok ? { ok: true, posted: out.posted } : out)
    }
    const tabs = body?.tabs
    return Response.json({ ok: await stub.userCall("browserTouch", [agentId, tabs as Record<string, string> | undefined]) })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 })
  }
}
