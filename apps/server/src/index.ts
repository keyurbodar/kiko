import type { BuilderBinding } from "./apps/builder-client"
import type { BackendDescriptor } from "@kiko/protocol"
import { serveAsset } from "./lib/assets"
import { devResponse } from "./lib/dev-guard"
import { BACKEND } from "./lib/version"
import { type AuthEnv, authRoute, getSessionUser } from "./auth/auth"
import { withCors } from "./lib/cors"
import { installRoute } from "./computer/install-route"
import { downloadRoute } from "./files/download"
import { uploadRoute } from "./files/upload"
import { route } from "./router"
import { hooksRoute } from "./user/hooks-route"
import { routinesRoute } from "./user/routines-route"
import { updateRoute } from "./user/update-route"
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
  BUILDER?: BuilderBinding
}

function version(env: Env): Response {
  const descriptor: BackendDescriptor = {
    kiko: 1,
    ...BACKEND,
    selfUpdate: Boolean(env.CF_GRANT),
    storage: env.FILES ? "r2" : "built-in",
  }
  return Response.json(descriptor)
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname === "/api/health") return Response.json({ ok: true })
  if (url.pathname === "/api/version") return version(env)
  const computer = await computerRoute(request, env)
  if (computer) return computer
  const routed = await route(request, env)
  if (routed) return routed
  const hooked = await hooksRoute(request, env)
  if (hooked) return hooked
  const routines = await routinesRoute(request, env)
  if (routines) return routines
  const updating = await updateRoute(request, env)
  if (updating) return updating
  const themed = await openVsxRoute(request, env)
  if (themed) return themed
  const icon = await faviconRoute(request, env)
  if (icon) return icon
  const install = await installRoute(request, env)
  if (install) return install
  const filed = (await uploadRoute(request, env, getSessionUser)) ?? (await downloadRoute(request, env, getSessionUser))
  if (filed) return filed
  const dev = await devResponse(request, env)
  if (dev) return dev
  if (url.pathname === "/api/me") {
    const user = await getSessionUser(request, env)
    return user ? Response.json({ user }) : Response.json({ error: "unauthorized" }, { status: 401 })
  }
  const authResponse = await authRoute(request, env)
  if (authResponse) return authResponse
  if (url.pathname.startsWith("/api/")) return new Response("not found", { status: 404 })
  return serveAsset(env.ASSETS, request)
}

export default {
  fetch: (request, env) => withCors(request, env, () => handle(request, env)),
} satisfies ExportedHandler<Env>
