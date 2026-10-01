import type { WebPagePreview } from "../../lib/types"

export interface FetchedPage {
  readonly status: number
  readonly contentType: string | null
  readonly html: string
}

export type PageFetcher = (url: string) => Promise<FetchedPage | null>

/** tweb's `.webpage-preview` box: `min(420px, 100%)` by `min(380px, 100%)`. */
export const MAX_PREVIEW_WIDTH = 420
export const MAX_PREVIEW_HEIGHT = 380

/** The aspect the card falls back to when a page declares no image size. */
const FALLBACK_ASPECT = 1.5

/** A page whose head is larger than this is not a preview, it is a download. */
const MAX_HTML_BYTES = 512_000

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

/**
 * The declared pixel size, scaled into tweb's preview box.
 *
 * tweb never trusts the declared size either: it mounts the picture and lets
 * `.webpage-preview` clip it at `min(420px, 100%)` by `min(380px, 100%)`
 * (`_chatBubble.scss:2770-2771`, and `mediaSizes.active.webpage` is the same
 * `420x380` at `helpers/mediaSizes.ts:85`). Clamping here means a page that
 * declares `4000x3000` reserves a box the card can actually draw, rather than
 * handing the layout a 3:1 ratio it has to undo.
 */
function capSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_PREVIEW_WIDTH / width, MAX_PREVIEW_HEIGHT / height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function previewImage(metadata: Metadata, pageUrl: string): WebPagePreview["media"] {
  const raw = firstOf(metadata, ["og:image", "og:image:url", "twitter:image", "twitter:image:src"])
  if (!raw) return undefined
  let src: string
  try {
    src = new URL(raw, pageUrl).href
  } catch {
    return undefined
  }
  const declaredWidth = Number.parseInt(
    metadata.get("og:image:width") ?? metadata.get("twitter:image:width") ?? "",
    10,
  )
  const declaredHeight = Number.parseInt(
    metadata.get("og:image:height") ?? metadata.get("twitter:image:height") ?? "",
    10,
  )
  if (!(declaredWidth > 0) || !(declaredHeight > 0)) {
    return {
      src,
      width: MAX_PREVIEW_WIDTH,
      height: Math.round(MAX_PREVIEW_WIDTH / FALLBACK_ASPECT),
    }
  }
  return { src, ...capSize(declaredWidth, declaredHeight) }
}

/**
 * Whether a preview carries anything a reader would recognise as a preview.
 *
 * This is tweb's `case 'messageMediaWebPage'` guard in one place: the renderer
 * breaks out and builds NOTHING unless the page is a real `webPage`, and inside
 * a real one each part renders only if its own field is non-empty
 * (`bubbles.ts:9348-9350`, `:9551`, `:9582`, `:9587`). So a URL that arrived
 * with no metadata is not a preview and gets no box — the URL stays a link in
 * the body, which is the body and not the card.
 *
 * Blank and whitespace-only count as absent, because tweb tests the RENDERED
 * text (`title.textContent`) and a run of spaces is not text.
 *
 * The height estimator and the card both ask this, deliberately. When they each
 * decided for themselves they drifted: the estimator reserved a card's chrome
 * for any object at all while the card rendered nothing, and the row measured
 * tall enough for a card that was never painted.
 */
export function hasWebPageContent(page: WebPagePreview | undefined): boolean {
  if (!page) return false
  return Boolean(page.media || page.title?.trim() || page.description?.trim() || page.site?.trim())
}

/**
 * The card a page's own head describes, or `null` when it describes nothing.
 *
 * The bar is deliberately lower than "any tag at all": a hostname is not
 * metadata, so a URL we could reach but could not read a single title,
 * description or picture from returns nothing rather than an empty bordered
 * box. That is the user's rule — no preview where there is no preview — and it
 * is why the site name's hostname fallback is applied only once some other
 * field has already earned the card its place.
 */
export function parseLinkPreview(html: string, pageUrl: string): WebPagePreview | null {
  let host: string
  try {
    host = new URL(pageUrl).hostname.replace(/^www\./, "")
  } catch {
    return null
  }

  const metadata = readMetadata(html)
  const titleTag = clean(html.match(TITLE_TAG)?.[1])
  const title = firstOf(metadata, ["og:title", "twitter:title"]) ?? titleTag ?? clean(metadata.get("author"))
  const description = firstOf(metadata, ["og:description", "twitter:description", "description"])
  const media = previewImage(metadata, pageUrl)

  if (!title && !description && !media) return null

  const declared = firstOf(metadata, ["og:site_name", "application-name", "twitter:site"])
  let site: string | undefined = declared ?? host
  if (site && title && site.toLowerCase() === title.toLowerCase()) site = undefined

  return { url: pageUrl, site, title, description, media }
}

export async function fetchPage(url: string): Promise<FetchedPage | null> {
  try {
    const response = await fetch(url, {
      credentials: "omit",
      redirect: "follow",
      headers: { accept: "text/html,application/xhtml+xml" },
    })
    if (!response.ok) return null
    const html = (await response.text()).slice(0, MAX_HTML_BYTES)
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      html,
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

/**
 * Ask one URL what it is, and get back the card it describes or nothing.
 *
 * The single fetcher is the seam. A browser cannot read a cross-origin page,
 * so the default fetcher answers `null` for most of the web — that is the
 * honest answer and it is why the caller keeps its existing link text rather
 * than an empty card. A proxy, a worker or a fixture suite supplies its own
 * `fetcher` and the whole path below is unchanged.
 *
 * A fetcher that REJECTS is the one failure this must absorb itself: the
 * default swallows its own errors, but an injected one is not obliged to, and
 * a CORS rejection is the single most likely thing a caller will ever see. A
 * preview is an enrichment, so an unreachable page is `null` — never a thrown
 * promise a composer has to catch around a keystroke.
 */
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