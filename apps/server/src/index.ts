import type { AgentDO } from "./agent/agent-do"
import { devResponse } from "./lib/dev-guard"
import { BACKEND } from "./lib/version"
import { type AuthEnv, authRoute, getSessionUser } from "./auth/auth"
import { userStub } from "./lib/names"
import { downloadRoute } from "./files/download"
import { uploadRoute } from "./files/upload"
import { route } from "./router"
import { credentialsRoute } from "./user/credentials-route"
import type { RoomDO } from "./room/room-do"
import type { UserDO } from "./user/user-do"
import { hooksRoute } from "./user/hooks-route"
import { loopsRoute } from "./user/loops-route"
import { routinesRoute } from "./user/routines-route"
import { remindersRoute } from "./user/reminders-route"
import { soulRoute } from "./user/soul-route"
import { searchRoute } from "./room/search-route"
import { recipesRoute } from "./recipes/route"
import { openVsxRoute } from "./themes/open-vsx-route"

export { AgentDO } from "./agent/agent-do"
export { RoomDO } from "./room/room-do"
export { UserDO } from "./user/user-do"

export interface Env extends AuthEnv {
  USER: DurableObjectNamespace<UserDO>
  ROOM: DurableObjectNamespace<RoomDO>
  AGENT: DurableObjectNamespace<AgentDO>
  FILES: R2Bucket
  ASSETS: Fetcher
  CREDENTIALS_KEK: string
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === "/api/health") return Response.json({ ok: true })
    if (url.pathname === "/api/version") return Response.json(BACKEND)
    const routed = await route(request, env)
    if (routed) return routed
    const credentials = await credentialsRoute(request, env)
    if (credentials) return credentials
    const reminders = await remindersRoute(request, env)
    if (reminders) return reminders
    const hooked = await hooksRoute(request, env)
    if (hooked) return hooked
    const routines = await routinesRoute(request, env)
    if (routines) return routines
    const loops = await loopsRoute(request, env)
    if (loops) return loops
    const soul = await soulRoute(request, env)
    if (soul) return soul
    const searched = await searchRoute(request, env)
    if (searched) return searched
    const recipes = await recipesRoute(request, env)
    if (recipes) return recipes
    const themed = await openVsxRoute(request, env)
    if (themed) return themed
    const filed = (await uploadRoute(request, env, getSessionUser)) ?? (await downloadRoute(request, env, getSessionUser))
    if (filed) return filed
    const dev = await devResponse(request, env)
    if (dev) return dev
    if (url.pathname === "/api/me") {
      const user = await getSessionUser(request, env)
      if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
      await userStub(env.USER, user.id).ensureHome()
      return Response.json({ user })
    }
    const authResponse = await authRoute(request, env)
    if (authResponse) return authResponse
    if (url.pathname.startsWith("/api/")) return new Response("not found", { status: 404 })
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
