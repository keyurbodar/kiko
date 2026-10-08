import { type Fetcher, safeFetch } from "@kiko/durable/safe-fetch"

export const IMAGE_PREFIX = "previews/"
const IMAGE_ROUTE = "/api/preview-image/"
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const IMAGE_TIMEOUT_MS = 8000
// SVG is left out on purpose. It can carry script.
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
])
const IMAGE_HEADERS = {
  "cache-control": "private, max-age=604800, immutable",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; sandbox",
}

type Keys = { seal: CryptoKey; iv: CryptoKey }
const keyCache = new Map<string, Promise<Keys>>()

function keys(secret: string): Promise<Keys> {
  let found = keyCache.get(secret)
  if (!found) {
    found = (async () => {
      const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveKey"])
      const derive = (info: string, algorithm: { name: string; hash?: string; length: number }, usages: ("encrypt" | "decrypt" | "sign")[]) =>
        crypto.subtle.deriveKey(
          { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: new TextEncoder().encode(info) },
          base,
          algorithm,
          false,
          usages,
        )
      return {
        seal: await derive("kiko preview image seal", { name: "AES-GCM", length: 256 }, ["encrypt", "decrypt"]),
        iv: await derive("kiko preview image iv", { name: "HMAC", hash: "SHA-256", length: 256 }, ["sign"]),
      }
    })()
    keyCache.set(secret, found)
  }
  return found
}

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

function fromBase64Url(text: string): Uint8Array | null {
  try {
    const raw = atob(text.replace(/-/g, "+").replace(/_/g, "/"))
    return Uint8Array.from(raw, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

export async function imagePath(secret: string, url: string): Promise<string> {
  const { seal, iv } = await keys(secret)
  const plain = new TextEncoder().encode(url)
  const nonce = new Uint8Array(await crypto.subtle.sign("HMAC", iv, plain)).slice(0, 12)
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, seal, plain))
  const token = new Uint8Array(nonce.length + sealed.length)
  token.set(nonce)
  token.set(sealed, nonce.length)
  return IMAGE_ROUTE + toBase64Url(token)
}

export async function openToken(secret: string, token: string): Promise<string | null> {
  const bytes = fromBase64Url(token)
  if (!bytes || bytes.length <= 12 + 16) return null
  try {
    const { seal } = await keys(secret)
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, seal, bytes.slice(12))
    return new TextDecoder().decode(plain)
  } catch {
    return null
  }
}

export async function imageHash(url: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

export async function fetchImage(url: string, fetcher?: Fetcher): Promise<{ type: string; body: Uint8Array } | "failed" | null> {
  const result = await safeFetch(url, fetcher, { maxBytes: MAX_IMAGE_BYTES, timeoutMs: IMAGE_TIMEOUT_MS })
  if (!result.ok) return result.reason === "timeout" || result.reason === "fetch-failed" ? "failed" : null
  if (result.status >= 500 || result.status === 429) return "failed"
  if (result.status !== 200 || result.truncated) return null
  const type = result.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? ""
  return IMAGE_TYPES.has(type) ? { type, body: result.body } : null
}

export type ImageEnv = { FILES: R2Bucket; BETTER_AUTH_SECRET: string }

export async function serveImage(
  env: ImageEnv,
  token: string,
  waitUntil: (work: Promise<unknown>) => void,
  fetcher?: Fetcher,
): Promise<Response> {
  const url = await openToken(env.BETTER_AUTH_SECRET, token)
  if (!url) return Response.json({ error: "not found" }, { status: 404 })
  const key = IMAGE_PREFIX + (await imageHash(url))
  const object = await env.FILES.get(key)
  if (object) {
    return new Response(object.body, {
      headers: { ...IMAGE_HEADERS, "content-type": object.httpMetadata?.contentType ?? "application/octet-stream" },
    })
  }
  const image = await fetchImage(url, fetcher)
  if (image === "failed") return new Response(null, { status: 503, headers: { "cache-control": "no-store" } })
  if (!image) return new Response(null, { status: 404, headers: { "cache-control": "private, max-age=300" } })
  waitUntil(
    env.FILES.put(key, image.body, { httpMetadata: { contentType: image.type } }).catch((e: unknown) =>
      console.error(`preview image store failed: ${e instanceof Error ? e.message : String(e)}`),
    ),
  )
  return new Response(image.body, { headers: { ...IMAGE_HEADERS, "content-type": image.type } })
}
