import type { LinkPreview } from "@kiko/protocol"
import { type Fetcher, safeFetch } from "@kiko/durable/safe-fetch"
import { imagePath } from "./image"
import { oembedFor } from "./oembed"
import { hasContent, type ParsedPage, parsePreview } from "./parse"

declare const process: { env: { NODE_ENV?: string } }

const HIT_TTL = 24 * 60 * 60
// 10 minutes. KV refuses anything under 60 seconds.
const MISS_TTL = 10 * 60
// A page that timed out or failed may answer next time. KV's shortest TTL.
const FAILED_TTL = 60
const MAX_HEAD_BYTES = 512 * 1024
// Sites serve OpenGraph tags to the bots they know. Telegram's is one of the most widely served.
export const PREVIEW_USER_AGENT = "TelegramBot (like TwitterBot)"
const KEY = "preview:v2:"
const CACHE_HOST = "https://preview-cache.kiko.internal/"
const END_OF_HEAD = /<\/head\s*>|<body[\s>]/i

export type PreviewEnv = { PREVIEWS: KVNamespace; BETTER_AUTH_SECRET: string }
export type Resolved = { preview: LinkPreview | null; cache: "hit" | "fresh" }
type Cached = { preview: LinkPreview | null }
type Built = { preview: LinkPreview | null; ttl: number }

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

export const devFixtureFetcher: Fetcher = async (url, init) => {
  const target = new URL(url)
  if (target.hostname === "cloudflare-dns.com") {
    const name = target.searchParams.get("name") ?? ""
    if (!/^fixture-\d+\.preview\.test$/.test(name)) return fetch(url, init)
    const a = target.searchParams.get("type") === "A"
    return Response.json({ Status: 0, Answer: a ? [{ name, type: 1, data: "93.184.216.34" }] : [] })
  }
  const match = /^fixture-(\d+)\.preview\.test$/.exec(target.hostname)
  if (!match) return fetch(url, init)
  return fetch(`http://localhost:${match[1]}${target.pathname}${target.search}`, init)
}

export const defaultFetcher = (): Fetcher | undefined =>
  process.env.NODE_ENV === "development" ? devFixtureFetcher : undefined

export function headWatcher(): (chunk: Uint8Array) => boolean {
  const decoder = new TextDecoder()
  let tail = ""
  return (chunk) => {
    const text = tail + decoder.decode(chunk, { stream: true })
    if (END_OF_HEAD.test(text)) return true
    tail = text.slice(-16)
    return false
  }
}

async function readPage(url: string, fetcher?: Fetcher): Promise<ParsedPage | "failed" | null> {
  const page = await safeFetch(url, fetcher, {
    maxBytes: MAX_HEAD_BYTES,
    stop: headWatcher(),
    userAgent: PREVIEW_USER_AGENT,
  })
  if (!page.ok) return page.reason === "timeout" || page.reason === "fetch-failed" ? "failed" : null
  if (page.status >= 500 || page.status === 429) return "failed"
  if (page.status !== 200) return null
  const type = page.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()
  if (type && type !== "text/html" && type !== "application/xhtml+xml") return null
  return parsePreview(new TextDecoder().decode(page.body), page.url)
}

async function readOembed(url: string, fetcher?: Fetcher): Promise<ParsedPage | null> {
  const provider = oembedFor(url)
  if (!provider) return null
  const answer = await safeFetch(provider.endpoint, fetcher, { userAgent: PREVIEW_USER_AGENT })
  if (!answer.ok || answer.status !== 200) return null
  try {
    return provider.read(JSON.parse(new TextDecoder().decode(answer.body)) as Record<string, unknown>)
  } catch {
    return null
  }
}

export async function buildPreview(env: PreviewEnv, url: string, fetcher?: Fetcher): Promise<Built> {
  const parsed = (await readOembed(url, fetcher)) ?? (await readPage(url, fetcher))
  if (parsed === "failed") return { preview: null, ttl: FAILED_TTL }
  if (!parsed || !hasContent(parsed)) return { preview: null, ttl: MISS_TTL }
  const preview: LinkPreview = { url }
  if (parsed.title) preview.title = parsed.title
  if (parsed.description) preview.description = parsed.description
  if (parsed.siteName) preview.siteName = parsed.siteName
  if (parsed.themeColor) preview.themeColor = parsed.themeColor
  if (parsed.image) preview.image = await imagePath(env.BETTER_AUTH_SECRET, parsed.image)
  if (parsed.favicon) preview.favicon = await imagePath(env.BETTER_AUTH_SECRET, parsed.favicon)
  return { preview, ttl: HIT_TTL }
}

// The Cache API is per data center and missing in tests, so every use is best effort.
const edgeCache = (): Cache | null => (typeof caches === "undefined" ? null : ((caches as unknown as { default?: Cache }).default ?? null))
const cacheRequest = (url: string) => new Request(CACHE_HOST + encodeURIComponent(url))

async function fromEdge(url: string): Promise<Cached | null> {
  try {
    const hit = await edgeCache()?.match(cacheRequest(url))
    return hit ? ((await hit.json()) as Cached) : null
  } catch {
    return null
  }
}

async function toEdge(url: string, value: Cached, ttl: number): Promise<void> {
  try {
    await edgeCache()?.put(
      cacheRequest(url),
      new Response(JSON.stringify(value), { headers: { "content-type": "application/json", "cache-control": `max-age=${ttl}` } }),
    )
  } catch {
  }
}

export async function cachedPreview(env: PreviewEnv, url: string, waitUntil: (work: Promise<unknown>) => void): Promise<Cached | null> {
  const edge = await fromEdge(url)
  if (edge) return edge
  const stored = await env.PREVIEWS.get<Cached>(KEY + url, "json")
  if (stored) waitUntil(toEdge(url, stored, stored.preview ? HIT_TTL : MISS_TTL))
  return stored
}

const inflight = new Map<string, Promise<LinkPreview | null>>()

export async function resolvePreview(
  env: PreviewEnv,
  url: string,
  waitUntil: (work: Promise<unknown>) => void,
  options: { fetcher?: Fetcher; cached?: Cached | null } = {},
): Promise<Resolved> {
  const cached = options.cached === undefined ? await cachedPreview(env, url, waitUntil) : options.cached
  if (cached) return { preview: cached.preview, cache: "hit" }
  let pending = inflight.get(url)
  if (!pending) {
    pending = buildPreview(env, url, options.fetcher ?? defaultFetcher()).then((built) => {
      const value: Cached = { preview: built.preview }
      waitUntil(
        Promise.all([
          env.PREVIEWS.put(KEY + url, JSON.stringify(value), { expirationTtl: built.ttl }),
          toEdge(url, value, built.ttl),
        ]).catch((e: unknown) => console.error(`preview cache write failed: ${e instanceof Error ? e.message : String(e)}`)),
      )
      return built.preview
    })
    const settled = pending.finally(() => inflight.delete(url))
    settled.catch(() => {})
    inflight.set(url, pending)
  }
  return { preview: await pending, cache: "fresh" }
}
