import { safeFetch } from "@kiko/durable/safe-fetch"
import { getSessionUser } from "../auth/auth"
import type { Env } from "../index"

// The browser asks the Worker for Open VSX pages and packages, so it never reaches another host.
// Only open-vsx.org over https, under /api/, and only for a signed-in owner.
const PATH = "/api/open-vsx"
const HOST = "open-vsx.org"
const MAX_BYTES = 20 * 1024 * 1024
const TIMEOUT_MS = 15_000

export function openVsxTarget(raw: string | null): string | null {
  if (!raw || raw.length > 2048) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const safe = url.protocol === "https:" && url.hostname === HOST && url.port === "" && !url.username && !url.password
  return safe && url.pathname.startsWith("/api/") ? url.href : null
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
  const landed = result.ok ? openVsxTarget(result.url) : null
  if (!result.ok || result.truncated || result.status !== 200 || landed === null) {
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
