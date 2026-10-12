import type { BetterAuthPlugin } from "better-auth"
import { APIError, createAuthEndpoint } from "better-auth/api"
import { setSessionCookie } from "better-auth/cookies"

const ACCESS_CODE_PATH = "/access-code"

const NAME = /^[a-z0-9][a-z0-9-]{0,31}$/

async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))
}

// Both digests are 32 bytes, and the loop always runs all of them, so the answer does not depend on where they differ.
async function matches(expected: string, given: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(expected), digest(given)])
  let diff = 0
  for (const [i, byte] of a.entries()) diff |= byte ^ (b[i] ?? 0)
  return diff === 0
}

// A real sign-in method for a deployed Worker. Registered only when the Worker has the ACCESS_CODE secret.
// Without it, Better Auth has no such route and answers 404.
export function accessCode(code: string) {
  return {
    id: "yuki-access-code",
    endpoints: {
      accessCode: createAuthEndpoint(ACCESS_CODE_PATH, { method: "POST" }, async (ctx) => {
        const input = ctx.body as { code?: unknown; name?: unknown } | undefined
        const name = input?.name
        if (typeof name !== "string" || !NAME.test(name)) {
          throw new APIError("BAD_REQUEST", { message: "name must match [a-z0-9-], 1 to 32 characters" })
        }
        const given = typeof input?.code === "string" ? input.code : ""
        if (!(await matches(code, given))) {
          throw new APIError("UNAUTHORIZED", { message: "That access code is not right" })
        }

        // The name picks the account, so people who share the code still get separate accounts.
        const email = `${name}@code.yuki`
        const adapter = ctx.context.internalAdapter
        const user =
          (await adapter.findUserByEmail(email))?.user ??
          (await adapter.createUser({ name, email, emailVerified: true }, { method: "code" }))
        const session = await adapter.createSession(user.id)
        await setSessionCookie(ctx, { session, user })
        return ctx.json({ user: { id: user.id, name: user.name, email: user.email } })
      }),
    },
  } satisfies BetterAuthPlugin
}
