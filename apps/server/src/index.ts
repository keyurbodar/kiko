import { serveAsset } from "./lib/assets"
import { devResponse } from "./lib/dev-guard"
import { BACKEND } from "./lib/version"
import { type AuthEnv, authRoute, getSessionUser } from "./auth/auth"
import { withCors } from "./lib/cors"
import { ownerStub } from "./lib/names"
import { downloadRoute } from "./files/download"
import { uploadRoute } from "./files/upload"
import { route } from "./router"
import { credentialsRoute } from "./user/credentials-route"
import { modelsRoute } from "./models/route"
import { hooksRoute } from "./user/hooks-route"
import { settingsRoute } from "./user/settings-route"
import { routinesRoute } from "./user/routines-route"
import { soulRoute } from "./user/soul-route"
import { searchRoute } from "./room/search-route"
import { recipesRoute } from "./recipes/route"
import { newAgentRoute } from "./user/new-agent-route"
import { faviconRoute } from "./favicon/route"
import { openVsxRoute } from "./themes/open-vsx-route"
import { storageRoute } from "./owner/storage-route"


export { OwnerDO } from "./owner/owner-do"
import type { OwnerDO } from "./owner/owner-do"

export interface Env extends AuthEnv {
  OWNER: DurableObjectNamespace<OwnerDO>
  /** Optional file storage. Without R2, bytes live in OwnerDO. */
  FILES?: R2Bucket
  /** Optional archive for room history older than 30 days. */
  ARCHIVE?: R2Bucket
  ASSETS: Fetcher
  CREDENTIALS_KEK: string
  /** The install's Cloudflare grant as JSON. UserDO keeps a rotated copy of its own. */
  CF_GRANT?: string
  /** Moves where releases are fetched from. It never changes the key that signs them. */
  RELEASE_BASE_URL?: string
}

// Signing in does not call /api/me, so without this a new account's first socket finds no Kiko chat.
async function withHome(response: Response, env: Env): Promise<Response> {
  if (!response.ok) return response
  const body = (await response.clone().json().catch(() => null)) as { user?: { id?: unknown } } | null
  if (typeof body?.user?.id === "string") await ownerStub(env.OWNER, body.user.id).ensureHome()
  return response
}

async function handle(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === "/api/health") return Response.json({ ok: true })
    if (url.pathname === "/api/version") return Response.json({ ...BACKEND, storage: env.FILES ? "r2" : "built-in" })
    const routed = await route(request, env)
    if (routed) return routed
    const credentials = await credentialsRoute(request, env)
    if (credentials) return credentials
    const models = await modelsRoute(request, env)
    if (models) return models
    const hooked = await hooksRoute(request, env)
    if (hooked) return hooked
    const routines = await routinesRoute(request, env)
    if (routines) return routines
    const settings = await settingsRoute(request, env)
    if (settings) return settings
    const storage = await storageRoute(request, env)
    if (storage) return storage
    const soul = await soulRoute(request, env)
    if (soul) return soul
    const searched = await searchRoute(request, env)
    if (searched) return searched
    const made = await newAgentRoute(request, env)
    if (made) return made
    const recipes = await recipesRoute(request, env)
    if (recipes) return recipes
    const themed = await openVsxRoute(request, env)
    if (themed) return themed
    const icon = await faviconRoute(request, env)
    if (icon) return icon
    const filed = (await uploadRoute(request, env, getSessionUser)) ?? (await downloadRoute(request, env, getSessionUser))
    if (filed) return filed
    const dev = await devResponse(request, env)
    if (dev) return url.pathname.startsWith("/api/auth/") ? withHome(dev, env) : dev
    if (url.pathname === "/api/me") {
      const user = await getSessionUser(request, env)
      if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
      await ownerStub(env.OWNER, user.id).ensureHome()
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
