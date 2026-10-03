import { betterAuth } from "better-auth"
import { devSession } from "./dev-session"

// Wrangler replaces process.env.NODE_ENV when it bundles: "production" for deploy and
// "development" for dev, unless NODE_ENV is set in the shell. Each comparison below is a
// constant, so the bundler drops the dev plugin from a production bundle.
declare const process: { env: { NODE_ENV?: string } }

export interface AuthEnv {
  AUTH_DB: D1Database
  BETTER_AUTH_SECRET: string
  /** The public origin. Defaults to the origin of the request. */
  BETTER_AUTH_URL?: string
  /** Extra origins allowed to call the auth routes, separated by commas. */
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

// A provider is on only when both of its values are set, so a machine without
// OAuth clients still runs.
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

/** Builds the auth instance for one request. Never keep it in module scope. */
export function createAuth(env: AuthEnv, request: Request) {
  return betterAuth({
    database: env.AUTH_DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL ?? new URL(request.url).origin,
    basePath: AUTH_PATH,
    trustedOrigins: [
      ...(env.TRUSTED_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? []),
      ...(process.env.NODE_ENV === "development" ? ["http://localhost:*"] : []),
    ],
    socialProviders: socialProviders(env),
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    plugins: process.env.NODE_ENV === "development" ? [devSession()] : [],
  })
}

/** True when the account with this id was deleted. */
export async function isDeletedUser(db: D1Database, userId: string): Promise<boolean> {
  return (await db.prepare(`SELECT 1 AS hit FROM "deleted_user" WHERE "id" = ?`).bind(userId).first("hit")) !== null
}

/**
 * Ends an account's access before any of its data is touched: writes the tombstone and
 * revokes every session in one batch. Safe to run twice.
 */
export async function revokeUser(db: D1Database, userId: string): Promise<void> {
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO "deleted_user" ("id", "deletedAt") VALUES (?, ?)`).bind(userId, Date.now()),
    db.prepare(`DELETE FROM "session" WHERE "userId" = ?`).bind(userId),
  ])
}

/**
 * The signed-in user of a request, or null. The only source of a user id in the Worker.
 * The cookie cache can still vouch for a deleted user's session, so the tombstone wins.
 */
export async function getSessionUser(request: Request, env: AuthEnv): Promise<SessionUser | null> {
  const session = await createAuth(env, request).api.getSession({ headers: request.headers })
  if (!session || (await isDeletedUser(env.AUTH_DB, session.user.id))) return null
  const { id, name, email, image } = session.user
  return { id, name, email, image: image ?? null }
}

/** Answers `/api/auth/*` and `/api/providers`. Returns null for every other path. `/api/me` is in `index.ts`. */
export async function authRoute(request: Request, env: AuthEnv): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (pathname.startsWith(`${AUTH_PATH}/`)) return createAuth(env, request).handler(request)
  if (pathname === "/api/providers") {
    // Which sign-in buttons the client shows. `dev` is true only in a development bundle.
    const on = socialProviders(env)
    return Response.json({ google: "google" in on, github: "github" in on, dev: process.env.NODE_ENV === "development" })
  }
  return null
}
