import { executorOAuth, executorOAuthPrefix } from "./experiments/executor-oauth"
import { runImports } from "./experiments/imports"
import type { AgentDO } from "./agent/agent-do"
import { authRoute, getSessionUser } from "./auth/auth"
import { downloadRoute } from "./files/download"
import { uploadRoute } from "./files/upload"
import { handleImageJob, isImageJob } from "./previews/image-job"
import { devFixtureFetcher, previewRoute } from "./previews/route"
import { route } from "./router"
import { experimentTurnRoute } from "./experiments/turn"
import type { RoomDO } from "./room/room-do"
import type { UserDO } from "./user/user-do"

export { AgentDO } from "./agent/agent-do"
export { RoomDO } from "./room/room-do"
export { UserDO } from "./user/user-do"

declare const process: { env: { NODE_ENV?: string } }

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
    const routed = await route(request, env)
    if (routed) return routed
    const filed = (await uploadRoute(request, env, getSessionUser)) ?? (await downloadRoute(request, env, getSessionUser))
    if (filed) return filed
    const previewed = await previewRoute(request, env)
    if (previewed) return previewed
    const authResponse = await authRoute(request, env)
    if (authResponse) return authResponse
    if (url.pathname === "/api/experiments/turn") return experimentTurnRoute(request, env)
    if (url.pathname.startsWith("/api/")) return new Response("not found", { status: 404 })
    return env.ASSETS.fetch(request)
  },
  async queue(batch, env) {
    // P8-04 owns the consumer. Until it lands, only the preview image job is handled here.
    const fetcher = process.env.NODE_ENV === "development" ? devFixtureFetcher : undefined
    for (const message of batch.messages) {
      if (isImageJob(message.body)) await handleImageJob(message.body, env.FILES, fetcher)
      message.ack()
    }
  },
} satisfies ExportedHandler<Env>
