import { devSessionRoute } from "../auth/dev-session"
import type { Env } from "../index"
import { devAgentRoute } from "../agent/dev-route"
import { devBrowserRoute } from "../user/dev-browser-route"
import { devUpdateRoute } from "../user/dev-update-route"
import { devModelsRoute } from "../user/dev-models-route"
import { devHealthRoute } from "../user/dev-health-route"
import { devRequest } from "./dev-guard"
import { devStatsRoute } from "./dev-stats"

export async function devRoutes(request: Request, env: Env): Promise<Response | null> {
  return (
    (await devSessionRoute(request, env)) ??
    (await devAgentRoute(request, env)) ??
    (await devBrowserRoute(request, env)) ??
    (await devUpdateRoute(request, env)) ??
    (await devModelsRoute(request, env)) ??
    (await devHealthRoute(request, env)) ??
    devStatsRoute(request, devRequest(new URL(request.url)))
  )
}
