import { executorOAuth, executorOAuthPrefix } from "./experiments/executor-oauth"
import { runImports } from "./experiments/imports"
import type { AgentDO } from "./agent/agent-do"
import { devAgentRoute } from "./agent/dev-route"
import { devStatsRoute } from "./lib/dev-stats"
import { authRoute, getSessionUser } from "./auth/auth"
import { userStub } from "./lib/names"
import { accountRoute } from "./auth/account-route"
import { downloadRoute } from "./files/download"
import { uploadRoute } from "./files/upload"
import { consume } from "./jobs/consumer"
import { previewRoute } from "./previews/route"
import { route } from "./router"
import { credentialsRoute } from "./user/credentials-route"
import { executorCallbackRoute } from "./integrations/executor/connect"
import { experimentTurnRoute } from "./experiments/turn"
import { experimentCoalescingRoute } from "./experiments/coalescing"
import type { RoomDO } from "./room/room-do"
import type { UserDO } from "./user/user-do"
import type { WorkDO } from "./jobs/work-do"
import { hooksRoute } from "./user/hooks-route"
import { routinesRoute } from "./user/routines-route"
import { remindersRoute } from "./user/reminders-route"
import { soulRoute } from "./user/soul-route"
import { searchRoute } from "./room/search-route"
import { setScriptWasm } from "@kiko/sandbox/wasm"
import quickjsWasm from "quickjs-wasi/quickjs.wasm"

setScriptWasm(quickjsWasm)

export { AgentDO } from "./agent/agent-do"
export { RoomDO } from "./room/room-do"
export { UserDO } from "./user/user-do"
export { WorkDO } from "./jobs/work-do"

declare const process: { env: { NODE_ENV?: string } }

export interface Env {
  USER: DurableObjectNamespace<UserDO>
  ROOM: DurableObjectNamespace<RoomDO>
  AGENT: DurableObjectNamespace<AgentDO>
  WORK?: DurableObjectNamespace<WorkDO>
  AUTH_DB: D1Database
  FILES: R2Bucket
  PREVIEWS: KVNamespace
  JOBS: Queue
  ASSETS: Fetcher
  CREDENTIALS_KEK: string
  CREDENTIALS_KEK_VERSION?: string
  CREDENTIALS_KEK_PREVIOUS?: string
  BETTER_AUTH_SECRET: string
  PROVIDER_OAUTH?: string
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname === "/api/health") return Response.json({ ok: true })
    if (url.pathname.startsWith(executorOAuthPrefix)) return executorOAuth(request)
    if (url.pathname === "/api/experiments/imports") return Response.json(await runImports())
    const routed = await route(request, env)
    if (routed) return routed
    const credentials = await credentialsRoute(request, env)
    if (credentials) return credentials
    const executorCallback = await executorCallbackRoute(request, env, getSessionUser)
    if (executorCallback) return executorCallback
    const reminders = await remindersRoute(request, env)
    if (reminders) return reminders
    const hooked = await hooksRoute(request, env)
    if (hooked) return hooked
    const routines = await routinesRoute(request, env)
    if (routines) return routines
    const soul = await soulRoute(request, env)
    if (soul) return soul
    const searched = await searchRoute(request, env)
    if (searched) return searched
    const filed = (await uploadRoute(request, env, getSessionUser)) ?? (await downloadRoute(request, env, getSessionUser))
    if (filed) return filed
    const previewed = await previewRoute(request, env, ctx)
    if (previewed) return previewed
    const devAgent = await devAgentRoute(request, env)
    if (devAgent) return devAgent
    const devStats = devStatsRoute(request)
    if (devStats) return devStats
    const account = await accountRoute(request, env)
    if (account) return account
    if (url.pathname === "/api/me") {
      const user = await getSessionUser(request, env)
      if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
      await userStub(env.USER, user.id).ensureHome()
      return Response.json({ user })
    }
    const authResponse = await authRoute(request, env)
    if (authResponse) return authResponse
    if (process.env.NODE_ENV === "development" && url.pathname === "/api/experiments/turn") return experimentTurnRoute(request, env)
    if (process.env.NODE_ENV === "development" && url.pathname === "/api/experiments/coalescing") return experimentCoalescingRoute(request, env)
    if (url.pathname.startsWith("/api/")) return new Response("not found", { status: 404 })
    return env.ASSETS.fetch(request)
  },
  async queue(batch, env) {
    await consume(batch, env)
  },
} satisfies ExportedHandler<Env>
