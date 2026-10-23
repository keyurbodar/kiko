import { type ClerkEnv, verifyClerkToken } from "./clerk"

export interface AuthEnv extends ClerkEnv {
  SESSION_SECRET: string
  TRUSTED_ORIGINS?: string
  ACCESS_CODE?: string
}

export interface SessionUser {
  id: string
  name: string
}

export const PRODUCTION_OWNER = "owner"
export const OWNER_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/

const AUTH_PATH = "/api/auth"

const encoder = new TextEncoder()

async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)))
}

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

type Scope = "session" | "files"

const SCOPE_TTL_S: Record<Scope, number> = { session: 30 * 24 * 60 * 60, files: 60 * 60 }
const SCOPE_STEP_S: Record<Scope, number> = { session: 1, files: 600 }

export async function signToken(secret: string, ownerId: string, scope: Scope, nowMs = Date.now()): Promise<string> {
  const step = SCOPE_STEP_S[scope]
  const body = `${ownerId}.${scope}.${Math.floor((Math.floor(nowMs / 1000) + SCOPE_TTL_S[scope]) / step) * step}`
  const mac = toHex(await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(body)))
  return `${body}.${mac}`
}

async function verifyToken(
  secret: string | undefined,
  token: string | null,
  scope: Scope,
  nowMs = Date.now(),
): Promise<SessionUser | null> {
  const parts = token?.split(".") ?? []
  const [id = "", tokenScope, expiry = "", macHex = ""] = parts
  const mac = fromHex(macHex)
  if (parts.length !== 4 || tokenScope !== scope || !mac || !OWNER_NAME.test(id) || !secret) return null
  if (!/^\d+$/.test(expiry) || Number(expiry) * 1000 <= nowMs) return null
  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret, "verify"),
    mac,
    encoder.encode(`${id}.${scope}.${expiry}`),
  )
  return ok ? { id, name: id } : null
}

export const SOCKET_PROTOCOL = "kiko"

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization")
  if (header) return /^Bearer (\S+)$/.exec(header)?.[1] ?? null
  const offered = (request.headers.get("sec-websocket-protocol") ?? "").split(",").map((p) => p.trim())
  return offered[0] === SOCKET_PROTOCOL ? (offered[1] ?? null) : null
}

export function getSessionUser(request: Request, env: AuthEnv): Promise<SessionUser | null> {
  return verifyToken(env.SESSION_SECRET, bearerToken(request), "session")
}

export function getFileUser(request: Request, env: AuthEnv): Promise<SessionUser | null> {
  return verifyToken(env.SESSION_SECRET, new URL(request.url).searchParams.get("t"), "files")
}

export async function signedInResponse(env: AuthEnv, ownerId: string): Promise<Response> {
  return Response.json({
    user: { id: ownerId, name: ownerId },
    token: await signToken(env.SESSION_SECRET, ownerId, "session"),
  })
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
    return signedInResponse(env, PRODUCTION_OWNER)
  }
  if (pathname === `${AUTH_PATH}/clerk` && env.CLERK_JWT_KEY && env.OWNER_ID) {
    const input = (await request.json().catch(() => null)) as { token?: unknown } | null
    if (typeof input?.token !== "string") return Response.json({ message: "token is required" }, { status: 400 })
    const verdict = await verifyClerkToken(
      { ...env, CLERK_JWT_KEY: env.CLERK_JWT_KEY, OWNER_ID: env.OWNER_ID },
      input.token,
    )
    if (!verdict.ok) return Response.json({ message: verdict.message }, { status: verdict.status })
    return signedInResponse(env, PRODUCTION_OWNER)
  }
  return null
}
