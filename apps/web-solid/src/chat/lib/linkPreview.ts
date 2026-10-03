import type { LinkPreview } from "@kiko/protocol"
import { createSignal } from "solid-js"
import type { WebPagePreview } from "../../lib/types"
import type { Warm } from "../../warm/db"
import { loadPreviews, type PreviewRecord, savePreview } from "../../warm/previews"
import { pickCardColor, SAMPLE_SIDE, themePanel } from "./cardColor"

/** The link card's width, from the kat screenshots. */
export const CARD_WIDTH = 340
// The server does not report image sizes, so every card crops its picture to the common 1200x630.
export const CARD_IMAGE_ASPECT = 1200 / 630
/** The previews held in memory. IndexedDB holds more. */
export const MEMORY_CAP = 100

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

/** True when the text is nothing but the card's link, so the card stands in for the bubble. */
export function isLinkOnly(body: string, page: WebPagePreview | undefined): boolean {
  const text = body.trim()
  if (!page || !hasWebPageContent(page) || !text || /\s/.test(text)) return false
  return previewKey(text) === previewKey(page.url) || previewKey(`https://${text}`) === previewKey(page.url)
}

/** The card for a preview the server sent, on a message or from `/api/preview`. */
export function fromServer(raw: LinkPreview): WebPagePreview | null {
  const preview: WebPagePreview = {
    url: raw.url,
    site: raw.siteName || undefined,
    title: raw.title || undefined,
    description: raw.description || undefined,
    favicon: raw.favicon || undefined,
    themeColor: raw.themeColor || undefined,
  }
  if (raw.image) {
    preview.media = {
      src: raw.image,
      width: CARD_WIDTH,
      height: Math.round(CARD_WIDTH / CARD_IMAGE_ASPECT),
    }
    preview.mediaSize = "large"
  }
  return hasWebPageContent(preview) ? preview : null
}

/** The cache key: an http(s) URL without its fragment, as the server keys it. */
export function previewKey(url: string): string | null {
  try {
    const parsed = new URL(url.trim())
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null
    parsed.hash = ""
    return parsed.href
  } catch {
    return null
  }
}

/** A map that forgets its least recently used entry past `cap`. */
export class Lru<K, V> {
  private readonly map = new Map<K, V>()
  constructor(readonly cap: number) {}
  get size() {
    return this.map.size
  }
  get(key: K): V | undefined {
    const value = this.map.get(key)
    if (value !== undefined) {
      this.map.delete(key)
      this.map.set(key, value)
    }
    return value
  }
  set(key: K, value: V): void {
    this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.cap) this.map.delete(this.map.keys().next().value as K)
  }
  clear(): void {
    this.map.clear()
  }
}

const memory = new Lru<string, PreviewRecord>(MEMORY_CAP)
const inflight = new Map<string, Promise<WebPagePreview | null>>()
let shelf: Warm | null = null
// Bumped when a colour lands, so a card on screen repaints.
const [colorTick, setColorTick] = createSignal(0)

/** Test hook. */
export function clearLinkPreviewCache(): void {
  memory.clear()
  inflight.clear()
  shelf = null
}

function store(record: PreviewRecord): void {
  memory.set(record.url, record)
  if (shelf) savePreview(shelf, record)
}

/**
 * Fills memory from IndexedDB before the first paint, so every recent card, and its colour, is
 * there synchronously.
 */
export async function attachPreviewShelf(warm: Warm): Promise<void> {
  shelf = warm
  try {
    const records = await loadPreviews(warm)
    for (const record of records.slice(0, MEMORY_CAP).reverse()) if (!memory.get(record.url)) memory.set(record.url, record)
  } catch {
    // The shelf is a cache. Without it cards load from the server.
  }
}

/** The preview for a URL if this tab already knows it: a card, null for none, undefined when unknown. */
export function peekLinkPreview(url: string): WebPagePreview | null | undefined {
  const key = previewKey(url)
  return key ? memory.get(key)?.preview : undefined
}

/** Remembers a preview the server attached to a message, so the composer and a reload get it free. */
export function rememberPreview(page: WebPagePreview): void {
  const key = previewKey(page.url)
  if (!key) return
  const known = memory.get(key)
  if (known?.preview && known.preview.media?.src === page.media?.src && known.preview.title === page.title) return
  store({ url: key, preview: page, color: known?.color, at: Date.now() })
}

/**
 * The panel colour for a card: the picture's colour once known, else the page's theme-color, else
 * undefined for the neutral surface. Reactive: it reads again when a colour lands.
 */
export function cardColor(page: WebPagePreview): string | undefined {
  colorTick()
  const key = previewKey(page.url)
  const picked = key ? memory.get(key)?.color : undefined
  if (picked) return picked
  return themePanel(page.themeColor) ?? undefined
}

/** True once the card's colour was worked out, whatever the answer. */
export function hasCardColor(page: WebPagePreview): boolean {
  const key = previewKey(page.url)
  return key ? memory.get(key)?.color !== undefined : false
}

/** Stores the colour picked for a card. Empty means the picture had none. */
export function rememberCardColor(page: WebPagePreview, color: string | null): void {
  const key = previewKey(page.url)
  if (!key) return
  const known = memory.get(key)
  if (known?.color === (color ?? "")) return
  store({ url: key, preview: known?.preview ?? page, color: color ?? "", at: Date.now() })
  setColorTick((n) => n + 1)
}

/** Decodes a picture at 24 px off the main thread where the browser can, and picks its colour. */
async function colorOfSource(src: string): Promise<string | null> {
  const response = await fetch(src)
  if (!response.ok) return null
  const bitmap = await createImageBitmap(await response.blob(), {
    resizeWidth: SAMPLE_SIDE,
    resizeHeight: SAMPLE_SIDE,
    resizeQuality: "low",
  })
  const canvas = new OffscreenCanvas(SAMPLE_SIDE, SAMPLE_SIDE)
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) return null
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  return pickCardColor(context.getImageData(0, 0, SAMPLE_SIDE, SAMPLE_SIDE).data)
}

const coloring = new Set<string>()

/**
 * Works the card's colour out ahead of the card, from the picture, then the favicon. The picture
 * lands in the HTTP cache on the way, so the card that follows paints it at once.
 */
export function warmCardColor(page: WebPagePreview): void {
  const key = previewKey(page.url)
  if (!key || hasCardColor(page) || coloring.has(key) || typeof createImageBitmap === "undefined") return
  coloring.add(key)
  void (async () => {
    let color: string | null = null
    for (const src of [ownMedia(page)?.src, ownFavicon(page)]) {
      if (!src) continue
      color = await colorOfSource(src).catch(() => null)
      if (color) break
    }
    rememberCardColor(page, color)
  })().finally(() => coloring.delete(key))
}

async function lookup(url: string): Promise<WebPagePreview | null> {
  const fromShelf = shelf ? await shelf.get<PreviewRecord>("previews", url).catch(() => undefined) : undefined
  if (fromShelf) {
    memory.set(url, fromShelf)
    return fromShelf.preview
  }
  const response = await fetch(`/api/preview?url=${encodeURIComponent(url)}`)
  // A 429 or a 5xx says nothing about the page, so it must not be cached.
  if (!response.ok) throw new Error(`preview ${response.status}`)
  const body = (await response.json()) as { preview?: LinkPreview | null } | null
  const preview = body?.preview ? fromServer(body.preview) : null
  store({ url, preview, at: Date.now() })
  if (preview) warmCardColor(preview)
  return preview
}

/**
 * The preview for one URL, or null when the server has none. Memory first, then IndexedDB, then
 * the server; one request per URL at a time. `signal` abandons this caller's wait without
 * cancelling a shared request.
 */
export async function resolveLinkPreview(url: string, signal?: AbortSignal): Promise<WebPagePreview | null> {
  const key = previewKey(url)
  if (!key) return null
  const known = memory.get(key)
  if (known) return known.preview

  let pending = inflight.get(key)
  if (!pending) {
    const created = lookup(key)
    pending = created
    inflight.set(key, created)
    void created.then(
      () => inflight.delete(key),
      () => inflight.delete(key),
    )
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
