import type { AuthEnv } from "../auth/auth"
import { originAllowed } from "../router"

const ALLOW_HEADERS = "Authorization, Content-Type, Range, X-Kiko-If-Sha256"
const ALLOW_METHODS = "GET, HEAD, POST, PUT, DELETE, OPTIONS"
const EXPOSE_HEADERS = "Content-Range, Content-Length, Accept-Ranges, ETag"

function crossOrigin(request: Request, env: AuthEnv): string | null {
  const origin = request.headers.get("origin")
  const url = new URL(request.url)
  if (!origin || origin === url.origin || !url.pathname.startsWith("/api/")) return null
  return originAllowed(request, url, env) ? origin : null
}

export async function withCors(request: Request, env: AuthEnv, handle: () => Promise<Response>): Promise<Response> {
  const origin = crossOrigin(request, env)
  if (request.method === "OPTIONS" && new URL(request.url).pathname.startsWith("/api/")) {
    const headers = new Headers({ vary: "Origin" })
    if (origin) {
      headers.set("access-control-allow-origin", origin)
      headers.set("access-control-allow-headers", ALLOW_HEADERS)
      headers.set("access-control-allow-methods", ALLOW_METHODS)
      headers.set("access-control-max-age", "600")
    }
    return new Response(null, { status: 204, headers })
  }
  const response = await handle().catch((error: unknown) => {
    console.error(error)
    return Response.json({ error: "internal error" }, { status: 500 })
  })
  if (response.webSocket) return response
  const out = new Response(response.body, response)
  out.headers.append("vary", "Origin")
  if (origin) {
    out.headers.set("access-control-allow-origin", origin)
    out.headers.set("access-control-expose-headers", EXPOSE_HEADERS)
  }
  return out
}
