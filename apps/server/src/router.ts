import { type AuthEnv, getSessionUser } from "./auth/auth"
import type { Env } from "./index"
import { humanHandle } from "@kiko/protocol"
import { boundedWait } from "@kiko/durable/bounded-wait"
import { DEV } from "./lib/dev-guard"
import { HANDLE_HEADER, NameError, ROOM_ID_HEADER, roomStub, USER_ID_HEADER, userStub } from "./lib/names"

export type SessionLookup = (request: Request, env: AuthEnv) => Promise<{ id: string; name?: string } | null>

type Target = { kind: "user" } | { kind: "room"; roomId: string }

const ROOM_PATH = /^\/api\/ws\/room\/([^/]+)$/

function match(pathname: string): Target | null {
  if (pathname === "/api/ws/user") return { kind: "user" }
  const room = ROOM_PATH.exec(pathname)
  const roomId = room?.[1]
  return roomId === undefined ? null : { kind: "room", roomId }
}

function error(status: number, message: string): Response {
  return Response.json({ error: message }, { status })
}

// A browser sends cookies on a cross-site socket upgrade, so a page on another origin could
// open a socket as the user. A request without an Origin header is not from a browser page.
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
  const target = match(url.pathname)
  if (!target) return null
  return within(UPGRADE_TIMEOUT_MS, upgrade(request, env, url, target, lookup))
}

export const UPGRADE_TIMEOUT_MS = 5_000

// If this Worker invocation ends first, the object's own hello deadline closes the socket.
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

async function upgrade(request: Request, env: Env, url: URL, target: Target, lookup: SessionLookup): Promise<Response> {
  if (!originAllowed(request, url, env)) return error(403, "forbidden origin")
  const user = await lookup(request, env)
  if (!user) return error(401, "unauthorized")
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return error(426, "expected a websocket upgrade")

  const headers = new Headers(request.headers)
  headers.set(USER_ID_HEADER, user.id)
  try {
    if (target.kind === "user") {
      headers.delete(ROOM_ID_HEADER)
      return await userStub(env.USER, user.id).fetch(new Request(request, { headers }))
    }
    const stub = roomStub(env.ROOM, user.id, target.roomId)
    headers.set(ROOM_ID_HEADER, target.roomId)
    headers.set(HANDLE_HEADER, humanHandle(user.name))
    return await stub.fetch(new Request(request, { headers }))
  } catch (e) {
    if (e instanceof NameError) return error(400, e.message)
    throw e
  }
}
