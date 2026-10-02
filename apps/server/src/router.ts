import { type AuthEnv, getSessionUser } from "./auth/auth"
import type { Env } from "./index"
import { NameError, ROOM_ID_HEADER, roomStub, USER_ID_HEADER, userStub } from "./lib/names"

// Architecture sections 4.2 and 9.1. The Worker checks the session, builds the object
// name from the session's user id, and forwards the socket upgrade. A client never names
// an object and never sends a user id.

declare const process: { env: { NODE_ENV?: string } }

/** Finds the signed-in user. Tests pass their own. */
export type SessionLookup = (request: Request, env: AuthEnv) => Promise<{ id: string } | null>

type Target = { kind: "user" } | { kind: "room"; roomId: string }

const ROOM_PATH = /^\/api\/ws\/room\/([^/]+)$/
const USER_ID_KEY = /^user[_-]?id$/i
const MAX_SCANNED_BODY = 1_000_000

function match(pathname: string): Target | null {
  if (pathname === "/api/ws/user") return { kind: "user" }
  const room = ROOM_PATH.exec(pathname)
  return room ? { kind: "room", roomId: room[1]! } : null
}

function error(status: number, message: string): Response {
  return Response.json({ error: message }, { status })
}

function hasUserIdKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasUserIdKey)
  if (value === null || typeof value !== "object") return false
  return Object.entries(value).some(([key, inner]) => USER_ID_KEY.test(key) || hasUserIdKey(inner))
}

/** True when the query or a JSON body names a user id. The session is the only source of one. */
async function carriesUserId(request: Request, url: URL): Promise<boolean> {
  for (const key of url.searchParams.keys()) if (USER_ID_KEY.test(key)) return true
  if (!request.body || !request.headers.get("content-type")?.includes("json")) return false
  const text = await request.clone().text()
  if (text.length > MAX_SCANNED_BODY) return false
  try {
    return hasUserIdKey(JSON.parse(text))
  } catch {
    return false
  }
}

// A browser sends cookies on a cross-site socket upgrade, so a page on another origin could
// open a socket as the user. A request without an Origin header is not from a browser page.
export function originAllowed(request: Request, url: URL, env: AuthEnv): boolean {
  const origin = request.headers.get("origin")
  if (!origin || origin === url.origin) return true
  const trusted = env.TRUSTED_ORIGINS?.split(",").map((o) => o.trim()) ?? []
  if (trusted.includes(origin)) return true
  return process.env.NODE_ENV === "development" && /^http:\/\/localhost(:\d+)?$/.test(origin)
}

/**
 * Answers the socket routes and refuses any `/api/` request that carries a user id.
 * Returns null for every other path. `/api/auth/*` belongs to Better Auth and is skipped.
 */
export async function route(request: Request, env: Env, lookup: SessionLookup = getSessionUser): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith("/api/") || url.pathname.startsWith("/api/auth/")) return null
  if (await carriesUserId(request, url)) return error(400, "a user id comes from the session, not the request")

  const target = match(url.pathname)
  if (!target) return null
  if (!originAllowed(request, url, env)) return error(403, "forbidden origin")
  const user = await lookup(request, env)
  if (!user) return error(401, "unauthorized")
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return error(426, "expected a websocket upgrade")

  // `set` replaces whatever the client sent under the same names.
  const headers = new Headers(request.headers)
  headers.set(USER_ID_HEADER, user.id)
  try {
    if (target.kind === "user") {
      headers.delete(ROOM_ID_HEADER)
      return await userStub(env.USER, user.id).fetch(new Request(request, { headers }))
    }
    const stub = roomStub(env.ROOM, user.id, target.roomId)
    headers.set(ROOM_ID_HEADER, target.roomId)
    return await stub.fetch(new Request(request, { headers }))
  } catch (e) {
    if (e instanceof NameError) return error(400, e.message)
    throw e
  }
}
