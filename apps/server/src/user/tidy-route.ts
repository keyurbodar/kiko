import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { userStub } from "../lib/names"
import { TIDY_PATH } from "./tidy"

/** `POST /api/memory/tidy` runs the session user's memory tidy now and answers its report. */
export async function tidyRoute(request: Request, env: Env): Promise<Response | null> {
  if (new URL(request.url).pathname !== TIDY_PATH) return null
  if (request.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405 })
  // A JSON content type needs a CORS preflight, so another site cannot post here with the cookie.
  if (!request.headers.get("content-type")?.includes("application/json")) return Response.json({ error: "expected json" }, { status: 415 })
  const user = await getSessionUser(request, env)
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
  return Response.json(await userStub(env.USER, user.id).tidyMemory())
}
