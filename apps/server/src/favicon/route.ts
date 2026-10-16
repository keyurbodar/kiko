import { type Fetcher, safeFetch } from "@kiko/durable/safe-fetch"
import { getFileUser, getSessionUser } from "../auth/auth"
import type { Env } from "../index"

// Architecture section 6.4. A link's icon comes from here, so the reader's browser never asks the
// linked site, and no third party sees which hosts a chat names. Only a public host with a dot is
// fetched, through the safe fetch helper, and the result is kept in the Cache API.
const PREFIX = "/api/favicon/"
const MAX_BYTES = 64 * 1024
const TIMEOUT_MS = 3000
const HIT_SECONDS = 7 * 24 * 3600
const MISS_SECONDS = 3600
const IMAGE = /^image\/(png|x-icon|vnd\.microsoft\.icon|jpeg|gif|webp|svg\+xml)$/i
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

/** A public DNS name, lower case, or null. An IP literal, a name with no dot, and a bad label are refused here. */
export function faviconHost(raw: string): string | null {
	const host = raw.toLowerCase().replace(/\.$/, "")
	if (host.length > 253) return null
	const labels = host.split(".")
	if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return null
	if (/^\d+$/.test(labels.at(-1) ?? "")) return null
	return host
}

const reply = (body: BodyInit | null, status: number, type: string | null, seconds: number) =>
	new Response(body, {
		status,
		headers: {
			...(type ? { "content-type": type } : {}),
			"cache-control": `public, max-age=${seconds}`,
			"x-content-type-options": "nosniff",
			"content-security-policy": "sandbox",
		},
	})

export async function fetchFavicon(host: string, fetcher?: Fetcher): Promise<Response> {
	const result = await safeFetch(`https://${host}/favicon.ico`, fetcher, { maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS, userAgent: "kiko-favicon" })
	const type = result.ok ? (result.headers.get("content-type")?.split(";")[0]?.trim() ?? "") : ""
	if (!result.ok || result.truncated || result.status !== 200 || !result.body.length || !IMAGE.test(type)) return reply(null, 404, null, MISS_SECONDS)
	return reply(result.body, 200, type.toLowerCase(), HIT_SECONDS)
}

export async function faviconRoute(request: Request, env: Env): Promise<Response | null> {
	const url = new URL(request.url)
	if (!url.pathname.startsWith(PREFIX)) return null
	if (request.method !== "GET") return Response.json({ error: "method not allowed" }, { status: 405 })
	const user = (await getFileUser(request, env)) ?? (await getSessionUser(request, env))
	if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
	const host = faviconHost(url.pathname.slice(PREFIX.length))
	if (!host) return reply(null, 404, null, MISS_SECONDS)
	const key = new Request(`https://favicon.cache.invalid/${host}`)
	const cached = await caches.default.match(key)
	if (cached) return cached
	const fresh = await fetchFavicon(host)
	await caches.default.put(key, fresh.clone())
	return fresh
}
