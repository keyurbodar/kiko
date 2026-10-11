import { type AuthEnv, getSessionUser } from "./auth/auth"
import type { Env } from "./index"
import { humanHandle } from "@yuki/protocol"
import { HANDLE_HEADER, NameError, ROOM_ID_HEADER, roomStub, USER_ID_HEADER, userStub } from "./lib/names"

declare const process: { env: { NODE_ENV?: string } }

export type SessionLookup = (request: Request, env: AuthEnv) => Promise<{ id: string; name?: string } | null>

type Target = { kind: "user" } | { kind: "room"; roomId: string }

const ROOM_PATH = /^\/api\/ws\/room\/([^/]+)$/
const USER_ID_KEY = /^user[_-]?id$/i
const MAX_SCANNED_BODY = 1_000_000

function match(pathname: string): Target | null {
  if (pathname === "/api/ws/user") return { kind: "user" }
  const room = ROOM_PATH.exec(pathname)
  const roomId = room?.[1]
  return roomId === undefined ? null : { kind: "room", roomId }
}

function error(status: number, message: string): Response {
  return Response.json({ error: message }, { status })
}

function hasUserIdKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasUserIdKey)
  if (value === null || typeof value !== "object") return false
  return Object.entries(value).some(([key, inner]) => USER_ID_KEY.test(key) || hasUserIdKey(inner))
}

// Reads a copy of the body, stopping as soon as it passes the cap, so a huge body is never
// held in memory just to find out that it cannot be scanned.
async function readCapped(request: Request, max: number): Promise<string | null> {
  if (!request.body) return ""
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      // The reader is a clone's branch of a tee; waiting on cancel would block on the branch
      // no one reads. The over-cap request is refused, so the original body is not needed.
      reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    all.set(chunk, at)
    at += chunk.byteLength
  }
  return new TextDecoder().decode(all)
}

// A body over the cap is refused, not read whole: the content-length header answers first,
// and a missing header is caught by the bounded read.
async function carriesUserId(request: Request, url: URL): Promise<boolean | "too_large"> {
  for (const key of url.searchParams.keys()) if (USER_ID_KEY.test(key)) return true
  if (!request.body || !request.headers.get("content-type")?.includes("json")) return false
  if (Number(request.headers.get("content-length") ?? 0) > MAX_SCANNED_BODY) return "too_large"
  const text = await readCapped(request.clone(), MAX_SCANNED_BODY)
  if (text === null) return "too_large"
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

export async function route(
  request: Request,
  env: Env,
  lookup: SessionLookup = getSessionUser,
  timeoutMs = UPGRADE_TIMEOUT_MS,
): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith("/api/") || url.pathname.startsWith("/api/auth/")) return null
  const scan = await carriesUserId(request, url)
  if (scan === "too_large") return error(413, "the body is larger than 1 mb")
  if (scan) return error(400, "a user id comes from the session, not the request")

  const target = match(url.pathname)
  if (!target) return null
  return within(timeoutMs, upgrade(request, env, url, target, lookup))
}

export const UPGRADE_TIMEOUT_MS = 5_000

// If this Worker invocation ends first, the object's own hello deadline closes the socket.
async function within(ms: number, work: Promise<Response>): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
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
    clearTimeout(timer)
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
