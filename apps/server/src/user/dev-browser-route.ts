import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { userStub } from "../lib/names"

// DEVELOPMENT ONLY. `POST /api/dev/user/browser-tabs { agentId, tabs }` and `browser-share
// { agentId, roomId, reason }` call the same RPCs the browser tools use (`browserTouch`,
// `browserShare`), so `verify browser-takeover` and the client check see the chip and the card
// without a model. Not found outside development.
export async function devBrowserRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  const share = url.pathname === "/api/dev/user/browser-share"
  if (process.env.NODE_ENV !== "development" || (url.pathname !== "/api/dev/user/browser-tabs" && !share) || request.method !== "POST") return null
  const user = await getSessionUser(request, env)
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { agentId?: string; tabs?: Record<string, string>; roomId?: string; reason?: string } | null
  try {
    const stub = userStub(env.USER, user.id)
    if (share) return Response.json({ ok: await stub.browserShare(body?.agentId as string, body?.roomId as string, body?.reason as string) })
    return Response.json({ ok: await stub.browserTouch(body?.agentId as string, body?.tabs) })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 409 })
  }
}
