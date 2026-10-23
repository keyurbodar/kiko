import { serveAsset } from "./lib/assets"
import { devResponse } from "./lib/dev-guard"
import { BACKEND } from "./lib/version"
import { type AuthEnv, authRoute, getSessionUser } from "./auth/auth"
import { withCors } from "./lib/cors"
import { ownerStub } from "./lib/names"
import { installRoute } from "./computer/install-route"
import { downloadRoute } from "./files/download"
import { uploadRoute } from "./files/upload"
import { route } from "./router"
import { hooksRoute } from "./user/hooks-route"
import { routinesRoute } from "./user/routines-route"
import { faviconRoute } from "./favicon/route"
import { openVsxRoute } from "./themes/open-vsx-route"
import { computerRoute } from "./computer/route"

export { OwnerDO } from "./owner/owner-do"
import type { OwnerDO } from "./owner/owner-do"

export interface Env extends AuthEnv {
  OWNER: DurableObjectNamespace<OwnerDO>
  FILES?: R2Bucket
  ARCHIVE?: R2Bucket
  ASSETS: Fetcher
  CREDENTIALS_KEK: string
  CF_TURN_KEY_ID?: string
  CF_TURN_KEY_TOKEN?: string
  CF_GRANT?: string
  RELEASE_BASE_URL?: string
}

async function withHome(response: Response, env: Env): Promise<Response> {
  if (!response.ok) return response
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { user?: { id?: unknown } } | null
  if (typeof body?.user?.id === "string") await ownerStub(env.OWNER, body.user.id).userCall("ensureHome", [])
  return response
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === "/api/health") return Response.json({ ok: true })
  if (url.pathname === "/api/version") return Response.json({ ...BACKEND, storage: env.FILES ? "r2" : "built-in" })
  const computer = await computerRoute(request, env)
  if (computer) return computer
  const routed = await route(request, env)
  if (routed) return routed
  const hooked = await hooksRoute(request, env)
  if (hooked) return hooked
  const routines = await routinesRoute(request, env)
  if (routines) return routines
  const themed = await openVsxRoute(request, env)
  if (themed) return themed
  const icon = await faviconRoute(request, env)
  if (icon) return icon
  const install = await installRoute(request, env)
  if (install) return install
  const filed = (await uploadRoute(request, env, getSessionUser)) ?? (await downloadRoute(request, env, getSessionUser))
  if (filed) return filed
  const dev = await devResponse(request, env)
  if (dev) return url.pathname.startsWith("/api/auth/") ? withHome(dev, env) : dev
  if (url.pathname === "/api/me") {
    const user = await getSessionUser(request, env)
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
    await ownerStub(env.OWNER, user.id).userCall("ensureHome", [])
    return Response.json({ user })
  }
  const authResponse = await authRoute(request, env)
  if (authResponse) return withHome(authResponse, env)
  if (url.pathname.startsWith("/api/")) return new Response("not found", { status: 404 })
  return serveAsset(env.ASSETS, request)
}

export default {
  fetch: (request, env) => withCors(request, env, () => handle(request, env)),
} satisfies ExportedHandler<Env>
