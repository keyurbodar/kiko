import type { WebPagePreview } from "../../lib/types"

export interface FetchedPage {
  readonly status: number
  readonly contentType: string | null
  readonly html: string
}

export type PageFetcher = (url: string) => Promise<FetchedPage | null>

export const MAX_PREVIEW_WIDTH = 420
export const MAX_PREVIEW_HEIGHT = 380

const FALLBACK_ASPECT = 1200 / 630
const MIN_LARGE_WIDTH = 200
const SQUARE_TOLERANCE = 0.1

const META_TAG = /<meta\b[^>]*>/gi
const TITLE_TAG = /<title[^>]*>([\s\S]*?)<\/title>/i
const ATTRIBUTE = /([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/g

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  middot: "·",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
}

const NAMED_ENTITY = /&(#x[\da-f]+|#\d+|[a-z][a-z\d]*);/gi

function decodeEntities(text: string): string {
  return text.replace(NAMED_ENTITY, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return ENTITIES[body.toLowerCase()] ?? match
  })
}

function attributesOf(tag: string): Map<string, string> {
  const attributes = new Map<string, string>()
  for (const match of tag.matchAll(ATTRIBUTE)) {
    const name = match[1].toLowerCase()
    if (!attributes.has(name)) attributes.set(name, match[2] ?? match[3] ?? match[4] ?? "")
  }
  return attributes
}

function clean(value: string | undefined): string | undefined {
  if (!value) return undefined
  const decoded = decodeEntities(value).replace(/\s+/g, " ").trim()
  return decoded.length > 0 ? decoded : undefined
}

type Metadata = Map<string, string>

function readMetadata(html: string): Metadata {
  const metadata: Metadata = new Map()
  for (const match of html.matchAll(META_TAG)) {
    const attributes = attributesOf(match[0])
    const key = clean(attributes.get("property") ?? attributes.get("name") ?? attributes.get("itemprop"))
    const value = clean(attributes.get("content"))
    if (!key || !value) continue
    const normalized = key.toLowerCase()
    if (!metadata.has(normalized)) metadata.set(normalized, value)
  }
  return metadata
}

function firstOf(metadata: Metadata, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = metadata.get(key)
    if (value) return value
  }
  return undefined
}

function capSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_PREVIEW_WIDTH / width, MAX_PREVIEW_HEIGHT / height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

interface PreviewImage {
  media: NonNullable<WebPagePreview["media"]>
  declared: { width: number; height: number } | undefined
}

function previewImage(metadata: Metadata, pageUrl: string): PreviewImage | undefined {
  const raw = firstOf(metadata, ["og:image", "og:image:url", "twitter:image", "twitter:image:src"])
  if (!raw) return undefined
  let src: string
  try {
    src = new URL(raw, pageUrl).href
  } catch {
    return undefined
  }
  const width = Number.parseInt(
    metadata.get("og:image:width") ?? metadata.get("twitter:image:width") ?? "",
    10,
  )
  const height = Number.parseInt(
    metadata.get("og:image:height") ?? metadata.get("twitter:image:height") ?? "",
    10,
  )
  if (!(width > 0) || !(height > 0)) {
    return {
      media: { src, width: MAX_PREVIEW_WIDTH, height: Math.round(MAX_PREVIEW_WIDTH / FALLBACK_ASPECT) },
      declared: undefined,
    }
  }
  return { media: { src, ...capSize(width, height) }, declared: { width, height } }
}

function mediaSizeOf(image: PreviewImage, metadata: Metadata): "large" | "small" {
  const card = metadata.get("twitter:card")?.toLowerCase()
  const type = metadata.get("og:type")?.toLowerCase() ?? ""
  if (card === "summary_large_image") return "large"
  if (type.startsWith("video") || type.startsWith("article")) return "large"
  if (card === "summary" || type === "profile") return "small"
  if (!image.declared) return "large"
  const { width, height } = image.declared
  if (width < MIN_LARGE_WIDTH) return "small"
  if (Math.abs(width - height) / Math.max(width, height) < SQUARE_TOLERANCE) return "small"
  return "large"
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

export function hasWebPageContent(page: WebPagePreview | undefined): boolean {
  if (!page) return false
  return Boolean(page.title?.trim() || page.description?.trim())
}

export function parseLinkPreview(html: string, pageUrl: string): WebPagePreview | null {
  let host: string
  try {
    host = new URL(pageUrl).hostname.replace(/^www\./, "")
  } catch {
    return null
  }

  const metadata = readMetadata(html)
  const titleTag = clean(html.match(TITLE_TAG)?.[1])
  const title = firstOf(metadata, ["og:title", "twitter:title"]) ?? titleTag
  const description = firstOf(metadata, ["og:description", "twitter:description", "description"])
  if (!title && !description) return null

  const image = previewImage(metadata, pageUrl)
  const declared = firstOf(metadata, ["og:site_name", "application-name"])
  let site: string | undefined = declared ?? host
  if (site && title && site.toLowerCase() === title.toLowerCase()) site = undefined

  const preview: WebPagePreview = { url: pageUrl, site, title, description }
  if (image) {
    preview.media = image.media
    preview.mediaSize = mediaSizeOf(image, metadata)
  }
  return preview
}

export async function fetchPage(url: string): Promise<FetchedPage | null> {
  try {
    const response = await fetch(`/api/link-preview?url=${encodeURIComponent(url)}`)
    if (response.status !== 200) return null
    const body = (await response.json()) as Partial<FetchedPage> | null
    if (!body || typeof body.status !== "number" || typeof body.html !== "string") return null
    return {
      status: body.status,
      contentType: typeof body.contentType === "string" ? body.contentType : null,
      html: body.html,
    }
  } catch {
    return null
  }
}

function isHtml(contentType: string | null): boolean {
  if (!contentType) return true
  const type = contentType.split(";")[0].trim().toLowerCase()
  return type === "text/html" || type === "application/xhtml+xml"
}

export async function resolveLinkPreview(
  url: string,
  fetcher: PageFetcher = fetchPage,
): Promise<WebPagePreview | null> {
  const trimmed = url.trim()
  if (!trimmed) return null

  let pageUrl: URL
  try {
    pageUrl = new URL(trimmed)
  } catch {
    return null
  }
  if (pageUrl.protocol !== "http:" && pageUrl.protocol !== "https:") return null

  let page: FetchedPage | null
  try {
    page = await fetcher(pageUrl.href)
  } catch {
    return null
  }
  if (!page) return null
  if (page.status < 200 || page.status > 299) return null
  if (!isHtml(page.contentType)) return null

  return parseLinkPreview(page.html, pageUrl.href)
}
