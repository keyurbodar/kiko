import { executorOAuth, executorOAuthPrefix } from "./experiments/executor-oauth"
import { runImports } from "./experiments/imports"
import type { AgentDO } from "./agent/agent-do"
import { authRoute } from "./auth/auth"
import type { RoomDO } from "./room/room-do"
import type { UserDO } from "./user/user-do"

export { AgentDO } from "./agent/agent-do"
export { RoomDO } from "./room/room-do"
export { UserDO } from "./user/user-do"

export interface Env {
  USER: DurableObjectNamespace<UserDO>
  ROOM: DurableObjectNamespace<RoomDO>
  AGENT: DurableObjectNamespace<AgentDO>
  AUTH_DB: D1Database
  FILES: R2Bucket
  PREVIEWS: KVNamespace
  JOBS: Queue
  ASSETS: Fetcher
  OPENCODE_API_KEY: string
  CREDENTIALS_KEK: string
  BETTER_AUTH_SECRET: string
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === "/api/health") return Response.json({ ok: true })
    if (url.pathname.startsWith(executorOAuthPrefix)) return executorOAuth(request)
    if (url.pathname === "/api/experiments/imports") return Response.json(await runImports())
    const authResponse = await authRoute(request, env)
    if (authResponse) return authResponse
    if (url.pathname.startsWith("/api/")) return new Response("not found", { status: 404 })
    return env.ASSETS.fetch(request)
  },
  async queue(batch) {
    batch.ackAll()
  },
} satisfies ExportedHandler<Env>
