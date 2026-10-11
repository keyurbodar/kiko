import type { BetterAuthPlugin } from "better-auth"
import { APIError, createAuthEndpoint } from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"

export const DEV_SESSION_PATH = "/dev/session"

const NAME = /^[a-z0-9][a-z0-9-]{0,31}$/
const LOCAL_HOSTS: Record<string, true> = { localhost: true, "127.0.0.1": true, "[::1]": true }

export function devSession() {
  return {
    id: "yuki-dev-session",
    endpoints: {
      devSession: createAuthEndpoint(DEV_SESSION_PATH, { method: ["GET", "POST"] }, async (ctx) => {
        // Second guard: a development build that reached a deployed host still refuses.
        const host = ctx.request ? new URL(ctx.request.url).hostname : ""
        if (LOCAL_HOSTS[host] !== true) throw new APIError("NOT_FOUND")

        const input = (ctx.method === "GET" ? ctx.query : ctx.body) as { name?: unknown } | undefined
        const name = input?.name ?? "dev"
        if (typeof name !== "string" || !NAME.test(name)) {
          throw new APIError("BAD_REQUEST", { message: "name must match [a-z0-9-], 1 to 32 characters" })
        }

        const email = `${name}@dev.yuki.test`
        const adapter = ctx.context.internalAdapter
        const user =
          (await adapter.findUserByEmail(email))?.user ??
          (await adapter.createUser({ name, email, emailVerified: true }, { method: "dev" }))
        const session = await adapter.createSession(user.id)
        await setSessionCookie(ctx, { session, user })

        // A browser opens this route with GET, so redirect it to the app with the cookie set.
        if (ctx.method === "GET") throw ctx.redirect("/")
        return ctx.json({ user: { id: user.id, name: user.name, email: user.email } })
      }),
    },
  } satisfies BetterAuthPlugin
}
