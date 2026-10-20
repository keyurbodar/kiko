import { type AuthEnv, getSessionUser, SOCKET_PROTOCOL } from "./auth/auth"
import type { Env } from "./index"
import { humanHandle } from "@kiko/protocol"
import { boundedWait } from "@kiko/durable/bounded-wait"
import { DEV } from "./lib/dev-guard"
import { HANDLE_HEADER, NameError, ROOM_ID_HEADER, USER_ID_HEADER, ownerStub } from "./lib/names"

export type SessionLookup = (request: Request, env: AuthEnv) => Promise<{ id: string; name?: string } | null>

function error(status: number, message: string): Response {
  return Response.json({ error: message }, { status })
}

export function originAllowed(request: Request, url: URL, env: AuthEnv): boolean {
  const origin = request.headers.get("origin")
  if (!origin || origin === url.origin) return true
  const trusted = env.TRUSTED_ORIGINS?.split(",").map((o) => o.trim()) ?? []
  if (trusted.includes(origin)) return true
  return DEV && /^http:\/\/localhost(:\d+)?$/.test(origin)
}

export async function route(request: Request, env: Env, lookup: SessionLookup = getSessionUser): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith("/api/") || url.pathname.startsWith("/api/auth/")) return null
  if (url.pathname !== "/api/ws") return null
  return within(UPGRADE_TIMEOUT_MS, upgrade(request, env, url, lookup))
}

const UPGRADE_TIMEOUT_MS = 5_000

async function within(ms: number, work: Promise<Response>): Promise<Response> {
  const wait = boundedWait(ms)
  const late = wait.then(() => null)
  try {
    const answer = await Promise.race([work, late])
    if (answer) return answer
    work.then(
      (response) => {
        if (!response.webSocket) return
        response.webSocket.accept()
        response.webSocket.close(1013, "socket setup timed out")
      },
      () => {},
    )
    return error(504, "socket setup timed out")
  } finally {
    wait.cancel()
  }
}

async function upgrade(request: Request, env: Env, url: URL, lookup: SessionLookup): Promise<Response> {
  if (!originAllowed(request, url, env)) return error(403, "forbidden origin")
  const user = await lookup(request, env)
  if (!user) return error(401, "unauthorized")
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return error(426, "expected a websocket upgrade")

  const headers = new Headers(request.headers)
  headers.set(USER_ID_HEADER, user.id)
  headers.delete(ROOM_ID_HEADER)
  try {
    headers.set(HANDLE_HEADER, humanHandle(user.name))
    const response = await ownerStub(env.OWNER, user.id).fetch(new Request(request, { headers }))
    const offered = (request.headers.get("sec-websocket-protocol") ?? "").split(",").map((p) => p.trim())
    if (!response.webSocket || !offered.includes(SOCKET_PROTOCOL)) return response
    return new Response(null, { status: 101, webSocket: response.webSocket, headers: { "sec-websocket-protocol": SOCKET_PROTOCOL } })
  } catch (e) {
    if (e instanceof NameError) return error(400, e.message)
    throw e
  }
}
