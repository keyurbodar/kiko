import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { serveImage } from "./image"
import { cachedPreview, defaultFetcher, normalizeUrl, resolvePreview } from "./resolve"

// Architecture section 18.2. The Worker fetches the page, the client never does.

const RATE_LIMIT = 30
const RATE_WINDOW_SECONDS = 60
const PREVIEW_PATH = "/api/preview"
const IMAGE_ROUTE = /^\/api\/preview-image\/([A-Za-z0-9_-]{40,4096})$/
// A browser keeps an answer for an hour, so a reload asks nothing. The client's own cache keeps it longer.
const ANSWER_CACHE = "private, max-age=3600"

const json = (body: unknown, status = 200, headers: HeadersInit = {}) => Response.json(body, { status, headers })

/** Best effort. KV is not atomic, so two requests at once may both pass. Only pages not cached count. */
async function underLimit(env: Env, userId: string): Promise<boolean> {
  const window = Math.floor(Date.now() / 1000 / RATE_WINDOW_SECONDS)
  const key = `rate:${userId}:${window}`
  const used = Number((await env.PREVIEWS.get(key)) ?? 0)
  if (used >= RATE_LIMIT) return false
  await env.PREVIEWS.put(key, String(used + 1), { expirationTtl: RATE_WINDOW_SECONDS * 2 })
  return true
}

/** Answers `/api/preview` and `/api/preview-image/:token`. Returns null for every other path. */
export async function previewRoute(request: Request, env: Env, ctx: Pick<ExecutionContext, "waitUntil">): Promise<Response | null> {
  const url = new URL(request.url)
  const image = IMAGE_ROUTE.exec(url.pathname)
  if (url.pathname !== PREVIEW_PATH && !image) return null
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: "unauthorized" }, 401)
  const waitUntil = (work: Promise<unknown>) => ctx.waitUntil(work)
  if (image) return serveImage(env, image[1]!, waitUntil, defaultFetcher())

  const normalized = normalizeUrl(url.searchParams.get("url") ?? "")
  if (!normalized) return json({ error: "a preview needs an http or https url" }, 400)

  const cached = await cachedPreview(env, normalized, waitUntil)
  if (cached) return json({ preview: cached.preview, cache: "hit" }, 200, { "cache-control": ANSWER_CACHE })
  if (!(await underLimit(env, user.id))) return json({ error: "too many previews" }, 429, { "retry-after": "60" })
  const { preview, cache } = await resolvePreview(env, normalized, waitUntil, { cached: null })
  return json({ preview, cache }, 200, { "cache-control": ANSWER_CACHE })
}
