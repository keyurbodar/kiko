export interface AuthEnv {
  SESSION_SECRET: string
  TRUSTED_ORIGINS?: string
  ACCESS_CODE?: string
}

export interface SessionUser {
  id: string
  name: string
}

// A deployed Worker has one owner. Development signs in as a named owner so each suite gets its own objects.
export const PRODUCTION_OWNER = "owner"
export const OWNER_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/

const AUTH_PATH = "/api/auth"
const COOKIE = "yuki_session"
const ONE_YEAR_S = 365 * 24 * 60 * 60

const encoder = new TextEncoder()

async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)))
}

// Both digests are 32 bytes, and the loop always runs all of them, so the answer does not depend on where they differ.
async function matches(expected: string, given: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(expected), digest(given)])
  let diff = 0
  for (const [i, byte] of a.entries()) diff |= byte ^ (b[i] ?? 0)
  return diff === 0
}

function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage])
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("")
}

function fromHex(hex: string): Uint8Array | null {
  if (!/^(?:[0-9a-f]{2})+$/.test(hex)) return null
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))
}

// The cookie holds the owner id and an HMAC of it, so the Worker needs no session table.
export async function sessionCookie(secret: string, ownerId: string, secure: boolean): Promise<string> {
  const mac = toHex(await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(ownerId)))
  const attributes = ["Path=/", `Max-Age=${ONE_YEAR_S}`, "HttpOnly", "SameSite=Lax", ...(secure ? ["Secure"] : [])]
  return `${COOKIE}=${ownerId}.${mac}; ${attributes.join("; ")}`
}

function clearedCookie(secure: boolean): string {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`
}

function cookieValue(request: Request): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === COOKIE) return rest.join("=")
  }
  return null
}

export async function getSessionUser(request: Request, env: AuthEnv): Promise<SessionUser | null> {
  const value = cookieValue(request)
  const dot = value?.lastIndexOf(".") ?? -1
  if (!value || dot < 1) return null
  const id = value.slice(0, dot)
  const mac = fromHex(value.slice(dot + 1))
  if (!mac || !OWNER_NAME.test(id) || !env.SESSION_SECRET) return null
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(env.SESSION_SECRET, "verify"), mac, encoder.encode(id))
  return ok ? { id, name: id } : null
}

function isSecure(request: Request): boolean {
  return new URL(request.url).protocol === "https:"
}

export async function signedInResponse(request: Request, env: AuthEnv, ownerId: string): Promise<Response> {
  const response = Response.json({ user: { id: ownerId, name: ownerId } })
  response.headers.append("set-cookie", await sessionCookie(env.SESSION_SECRET, ownerId, isSecure(request)))
  return response
}

export async function authRoute(request: Request, env: AuthEnv): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (!pathname.startsWith(`${AUTH_PATH}/`)) return null
  if (request.method !== "POST") return Response.json({ message: "method not allowed" }, { status: 405 })
  if (pathname === `${AUTH_PATH}/access-code` && env.ACCESS_CODE) {
    const input = (await request.json().catch(() => null)) as { code?: unknown } | null
    const given = typeof input?.code === "string" ? input.code : ""
    if (!(await matches(env.ACCESS_CODE, given))) {
      return Response.json({ message: "That access code is not right" }, { status: 401 })
    }
    return signedInResponse(request, env, PRODUCTION_OWNER)
  }
  if (pathname === `${AUTH_PATH}/sign-out`) {
    const response = Response.json({ ok: true })
    response.headers.append("set-cookie", clearedCookie(isSecure(request)))
    return response
  }
  return null
}
