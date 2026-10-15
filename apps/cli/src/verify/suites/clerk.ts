// Trading a Clerk session token for the backend's own session. It needs a Clerk dev instance and a Worker that
// trusts its test owner, so the suite prints a note and passes when either is missing:
//   set -a; . apps/server/.dev.vars; set +a
//   bun scripts/clerk-dev.ts up        prints the --var flags for the Worker, and KIKO_CLERK_OWNER_ID
//   bun run --cwd apps/server dev --port <n> --var OWNER_ID:... --var CLERK_JWT_KEY:...
//   KIKO_CLERK_OWNER_ID=... bun kiko verify clerk --url http://localhost:<n>
//   bun scripts/clerk-dev.ts down      deletes the test users
import { expectEqual } from "../client"
import { clerkSecret, deleteUser, ensureUser, sessionToken, STRANGER_EXTERNAL_ID } from "../clerk-kit"
import type { Suite } from "../runner"

const suite: Suite = {
  name: "clerk",
  async run(v) {
    const owner = process.env.KIKO_CLERK_OWNER_ID
    if (!clerkSecret() || !owner) {
      console.log("  skipped: set CLERK_SECRET_KEY and KIKO_CLERK_OWNER_ID (see the top of suites/clerk.ts)")
      return
    }
    const exchange = (token: unknown) =>
      fetch(new URL("api/auth/clerk", v.url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) })
    if ((await exchange("probe")).status === 404) {
      console.log("  skipped: this Worker has no CLERK_JWT_KEY and OWNER_ID")
      return
    }
    try {
      const good = await exchange(await sessionToken(owner))
      expectEqual(good.status, 200, "the owner's Clerk token")
      const { user, token } = (await good.json()) as { user: { id: string }; token: string }
      expectEqual(user.id, "owner", "the session is the constant owner")
      const me = await fetch(new URL("api/me", v.url), { headers: { authorization: `Bearer ${token}` } })
      expectEqual(me.status, 200, "GET /api/me with the traded bearer")
      console.log("  ok owner: a real Clerk session token trades for a working bearer")

      const stranger = await ensureUser(STRANGER_EXTERNAL_ID)
      expectEqual((await exchange(await sessionToken(stranger))).status, 403, "another user's Clerk token")
      expectEqual((await exchange("not.a.token")).status, 401, "a malformed token")
      const [head, , sig] = (await sessionToken(owner)).split(".")
      const forged = Buffer.from(JSON.stringify({ sub: owner, exp: 9_999_999_999 })).toString("base64url")
      expectEqual((await exchange(`${head}.${forged}.${sig}`)).status, 401, "a tampered token")
      console.log("  ok refusals: another user is 403, a malformed or tampered token is 401")
    } finally {
      await deleteUser(STRANGER_EXTERNAL_ID)
    }
  },
}

export default suite
