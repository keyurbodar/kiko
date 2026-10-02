import type { WebPagePreview } from "../../lib/types"

export const MAX_PREVIEW_WIDTH = 420
export const MAX_PREVIEW_HEIGHT = 380

// The server does not report image sizes. Assume the common 1200x630 card.
const FALLBACK_ASPECT = 1200 / 630

/** What `GET /api/preview` returns for a page it could read. */
interface ServerPreview {
  url: string
  title?: string
  description?: string
  siteName?: string
  image?: string
  favicon?: string
}

/**
 * Whether a preview image may load. Only kiko's own origin is allowed, so a
 * page's og:image never makes the reader's browser contact a third party. A
 * relative path counts as kiko's origin.
 */
export function isOwnOriginImage(src: string, origin = globalThis.location?.origin): boolean {
  if (!origin) return false
  try {
    return new URL(src, origin).origin === origin
  } catch {
    return false
  }
}

/** The preview's media, or undefined when its image is not on kiko's origin. */
export function ownMedia(page: WebPagePreview | undefined): WebPagePreview["media"] {
  const media = page?.media
  return media && isOwnOriginImage(media.src) ? media : undefined
}

/** The preview's favicon, or undefined when it is not on kiko's origin. */
export function ownFavicon(page: WebPagePreview | undefined): string | undefined {
  const src = page?.favicon
  return src && isOwnOriginImage(src) ? src : undefined
}

export function hasWebPageContent(page: WebPagePreview | undefined): boolean {
  if (!page) return false
  return Boolean(page.title?.trim() || page.description?.trim())
}

function fromServer(raw: ServerPreview): WebPagePreview | null {
  const preview: WebPagePreview = {
    url: raw.url,
    site: raw.siteName || undefined,
    title: raw.title || undefined,
    description: raw.description || undefined,
    favicon: raw.favicon || undefined,
  }
  if (raw.image) {
    preview.media = {
      src: raw.image,
      width: MAX_PREVIEW_WIDTH,
      height: Math.round(MAX_PREVIEW_WIDTH / FALLBACK_ASPECT),
    }
    preview.mediaSize = "large"
  }
  return hasWebPageContent(preview) ? preview : null
}

const cache = new Map<string, Promise<WebPagePreview | null>>()

/** Test hook. */
export function clearLinkPreviewCache(): void {
  cache.clear()
}

async function lookup(url: string): Promise<WebPagePreview | null> {
  const response = await fetch(`/api/preview?url=${encodeURIComponent(url)}`)
  // A 429 or a 5xx says nothing about the page, so it must not be cached.
  if (!response.ok) throw new Error(`preview ${response.status}`)
  const body = (await response.json()) as { preview?: ServerPreview | null } | null
  return body?.preview ? fromServer(body.preview) : null
}

/**
 * The preview for one URL, or null when the server has none. Results are
 * cached per URL for the life of the page, so a transcript never refetches.
 * `signal` abandons this caller's wait without cancelling a shared request.
 */
export async function resolveLinkPreview(url: string, signal?: AbortSignal): Promise<WebPagePreview | null> {
  let pageUrl: URL
  try {
    pageUrl = new URL(url.trim())
  } catch {
    return null
  }
  if (pageUrl.protocol !== "http:" && pageUrl.protocol !== "https:") return null
  const key = pageUrl.href

  let pending = cache.get(key)
  if (!pending) {
    const created = lookup(key)
    pending = created
    cache.set(key, created)
    created.catch(() => {
      if (cache.get(key) === created) cache.delete(key)
    })
  }
  const aborted = new Promise<never>((_, reject) => {
    const abort = () => reject(new DOMException("aborted", "AbortError"))
    if (signal?.aborted) abort()
    else signal?.addEventListener("abort", abort, { once: true })
  })
  try {
    return await Promise.race([pending, aborted])
  } catch {
    return null
  }
}
