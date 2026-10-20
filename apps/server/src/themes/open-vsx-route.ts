import { safeFetch } from "@kiko/durable/safe-fetch"
import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"

const PATH = "/api/open-vsx"
const HOST = "open-vsx.org"
const CDN_HOST = "openvsx.eclipsecontent.org"
const MAX_BYTES = 20 * 1024 * 1024
const TIMEOUT_MS = 15_000

function secureUrl(raw: string): URL | null {
  if (raw.length > 2048) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  return url.protocol === "https:" && url.port === "" && !url.username && !url.password ? url : null
}

function openVsxTarget(raw: string | null): string | null {
  const url = raw ? secureUrl(raw) : null
  return url?.hostname === HOST && url.pathname.startsWith("/api/") ? url.href : null
}

const landedOnOpenVsx = (href: string) => {
  const url = secureUrl(href)
  return url !== null && (url.hostname === HOST || url.hostname === CDN_HOST)
}

export async function openVsxRoute(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== PATH) return null
  if (request.method !== "GET") return Response.json({ error: "method not allowed" }, { status: 405 })
  const user = await getSessionUser(request, env)
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 })
  const target = openVsxTarget(url.searchParams.get("url"))
  if (!target) return Response.json({ error: "not an Open VSX address" }, { status: 400 })

  const result = await safeFetch(target, undefined, { maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS, userAgent: "kiko-theme-import" })
  if (!result.ok || result.truncated || result.status !== 200 || !landedOnOpenVsx(result.url)) {
    return Response.json({ error: "Open VSX is unavailable right now." }, { status: 502 })
  }
  return new Response(result.body, {
    headers: {
      "content-type": result.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  })
}
