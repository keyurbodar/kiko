import { betterAuth } from "better-auth"
import { DEV, devAuthPlugins, devTrustedOrigins } from "../lib/dev-guard"

export interface AuthEnv {
  AUTH_DB: D1Database
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL?: string
  TRUSTED_ORIGINS?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
}

export interface SessionUser {
  id: string
  name: string
  email: string
  image: string | null
}

const AUTH_PATH = "/api/auth"

function socialProviders(env: AuthEnv) {
  const pairs = {
    google: [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET],
    github: [env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET],
  } as const
  const providers: Partial<Record<keyof typeof pairs, { clientId: string; clientSecret: string }>> = {}
  for (const [id, [clientId, clientSecret]] of Object.entries(pairs)) {
    if (clientId && clientSecret) providers[id as keyof typeof pairs] = { clientId, clientSecret }
  }
  return providers
}

export function createAuth(env: AuthEnv, request: Request) {
  return betterAuth({
    database: env.AUTH_DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL ?? new URL(request.url).origin,
    basePath: AUTH_PATH,
    trustedOrigins: [
      ...(env.TRUSTED_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? []),
      ...devTrustedOrigins(),
    ],
    socialProviders: socialProviders(env),
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      // Schema is owned by D1 migrations; validating per instance reads it on every request.
      database: { validateSchema: false },
    },
    plugins: devAuthPlugins(),
  })
}

export async function isDeletedUser(db: D1Database, userId: string): Promise<boolean> {
  return (await db.prepare(`SELECT 1 AS hit FROM "deleted_user" WHERE "id" = ?`).bind(userId).first("hit")) !== null
}

// Trusting "not deleted" for 30s avoids a D1 round trip per request; deletion also blocks sockets and rooms in UserDO.
export const LIVE_USER_TTL_MS = 30_000
const liveUsers = new Map<string, number>()

async function deleted(db: D1Database, userId: string, now = Date.now()): Promise<boolean> {
  if ((liveUsers.get(userId) ?? 0) > now) return false
  if (await isDeletedUser(db, userId)) return true
  if (liveUsers.size > 10_000) liveUsers.clear()
  liveUsers.set(userId, now + LIVE_USER_TTL_MS)
  return false
}

export async function revokeUser(db: D1Database, userId: string): Promise<void> {
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO "deleted_user" ("id", "deletedAt") VALUES (?, ?)`).bind(userId, Date.now()),
    db.prepare(`DELETE FROM "session" WHERE "userId" = ?`).bind(userId),
  ])
  liveUsers.delete(userId)
}

export async function restoreUser(db: D1Database, userId: string): Promise<void> {
  await db.prepare(`DELETE FROM "deleted_user" WHERE "id" = ?`).bind(userId).run()
}

// The cookie cache can vouch for a deleted user's session without D1, so the tombstone check here is authoritative.
export async function getSessionUser(request: Request, env: AuthEnv): Promise<SessionUser | null> {
  const session = await createAuth(env, request).api.getSession({ headers: request.headers })
  if (!session || (await deleted(env.AUTH_DB, session.user.id))) return null
  const { id, name, email, image } = session.user
  return { id, name, email, image: image ?? null }
}

export async function authRoute(request: Request, env: AuthEnv): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (pathname.startsWith(`${AUTH_PATH}/`)) return createAuth(env, request).handler(request)
  if (pathname === "/api/providers") {
    const on = socialProviders(env)
    return Response.json({ google: "google" in on, github: "github" in on, dev: DEV })
  }
  return null
}
