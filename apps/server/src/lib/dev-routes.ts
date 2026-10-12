import { devSessionRoute } from "../auth/dev-session"
import type { Env } from "../index"
import { devAgentRoute } from "../agent/dev-route"
import { devBrowserRoute } from "../user/dev-browser-route"
import { devRequest } from "./dev-guard"
import { devStatsRoute } from "./dev-stats"

// Reached only through devResponse in dev-guard.ts.
export async function devRoutes(request: Request, env: Env): Promise<Response | null> {
  return (await devSessionRoute(request, env)) ?? (await devAgentRoute(request, env)) ?? (await devBrowserRoute(request, env)) ?? devStatsRoute(request, devRequest(new URL(request.url)))
}
