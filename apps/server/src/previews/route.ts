import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"
import { type Fetcher, safeFetch } from "../lib/safe-fetch"
import { enqueueImage, IMAGE_PREFIX } from "./image-job"
import { hasContent, parsePreview } from "./parse"

// Architecture section 18.2. The Worker fetches the page, the client never does.

declare const process: { env: { NODE_ENV?: string } }

const HIT_TTL = 24 * 60 * 60
// 10 minutes. KV refuses anything under 60 seconds.
const MISS_TTL = 10 * 60
const RATE_LIMIT = 30
const RATE_WINDOW_SECONDS = 60
const PREVIEW_PATH = "/api/preview"
const IMAGE_ROUTE = /^\/api\/preview-image\/([0-9a-f]{64})$/

export interface Preview {
  url: string
  title?: string
  description?: string
  siteName?: string
  /** A path on kiko's origin. */
  image?: string
  /** A path on kiko's origin. */
  favicon?: string
}

type Cached = { preview: Preview | null }

/** The key is the URL without its fragment. `URL` already folds host case and default ports. */
export function normalizeUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  url.hash = ""
  url.username = ""
  url.password = ""
  return url.href
}

const json = (body: unknown, status = 200, headers: HeadersInit = {}) => Response.json(body, { status, headers })

/**
 * Development only. A host named `fixture-<port>.preview.test` resolves to a public address
 * and fetches from `http://localhost:<port>`, so a verify suite can serve a page without a
 * public host. Every request still goes through `safeFetch`.
 */
export const devFixtureFetcher: Fetcher = async (url, init) => {
  const target = new URL(url)
  if (target.hostname === "cloudflare-dns.com") {
    const name = target.searchParams.get("name") ?? ""
    // Only fixture names are answered here. Every other name asks the real resolver, so a dev
    // server previews real sites the way production does.
    if (!/^fixture-\d+\.preview\.test$/.test(name)) return fetch(url, init)
    const a = target.searchParams.get("type") === "A"
    return Response.json({ Status: 0, Answer: a ? [{ name, type: 1, data: "93.184.216.34" }] : [] })
  }
  const match = /^fixture-(\d+)\.preview\.test$/.exec(target.hostname)
  if (!match) return fetch(url, init)
  return fetch(`http://localhost:${match[1]}${target.pathname}${target.search}`, init)
}

/** Best effort. KV is not atomic, so two requests at once may both pass. */
async function underLimit(env: Env, userId: string): Promise<boolean> {
  const window = Math.floor(Date.now() / 1000 / RATE_WINDOW_SECONDS)
  const key = `rate:${userId}:${window}`
  const used = Number((await env.PREVIEWS.get(key)) ?? 0)
  if (used >= RATE_LIMIT) return false
  await env.PREVIEWS.put(key, String(used + 1), { expirationTtl: RATE_WINDOW_SECONDS * 2 })
  return true
}

async function build(env: Env, url: string, fetcher?: Fetcher): Promise<Preview | null> {
  const page = await safeFetch(url, fetcher)
  if (!page.ok || page.status !== 200) return null
  const type = page.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()
  if (type && type !== "text/html" && type !== "application/xhtml+xml") return null

  const parsed = await parsePreview(new TextDecoder().decode(page.body), page.url)
  if (!hasContent(parsed)) return null

  const preview: Preview = { url, title: parsed.title, description: parsed.description, siteName: parsed.siteName }
  if (parsed.image) preview.image = await enqueueImage(env.JOBS, parsed.image)
  if (parsed.favicon) preview.favicon = await enqueueImage(env.JOBS, parsed.favicon)
  return preview
}

async function previewImage(env: Env, hash: string): Promise<Response> {
  const object = await env.FILES.get(IMAGE_PREFIX + hash)
  if (!object) return json({ error: "not found" }, 404)
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "private, max-age=86400, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  })
}

/** Answers `/api/preview` and `/api/preview-image/:hash`. Returns null for every other path. */
export async function previewRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  const image = IMAGE_ROUTE.exec(url.pathname)
  if (url.pathname !== PREVIEW_PATH && !image) return null
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405)
  const user = await getSessionUser(request, env)
  if (!user) return json({ error: "unauthorized" }, 401)
  if (image) return previewImage(env, image[1]!)

  const normalized = normalizeUrl(url.searchParams.get("url") ?? "")
  if (!normalized) return json({ error: "a preview needs an http or https url" }, 400)
  if (!(await underLimit(env, user.id))) return json({ error: "too many previews" }, 429, { "retry-after": "60" })

  const key = `preview:${normalized}`
  const cached = await env.PREVIEWS.get<Cached>(key, "json")
  if (cached) return json({ preview: cached.preview, cache: "hit" })

  const fetcher = process.env.NODE_ENV === "development" ? devFixtureFetcher : undefined
  const preview = await build(env, normalized, fetcher)
  await env.PREVIEWS.put(key, JSON.stringify({ preview } satisfies Cached), {
    expirationTtl: preview ? HIT_TTL : MISS_TTL,
  })
  return json({ preview, cache: "fresh" })
}
