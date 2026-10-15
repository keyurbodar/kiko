import { createClerkClient } from "@clerk/backend"
import { DurableObject } from "cloudflare:workers"
import { InstallError } from "./cf"
import handler, { type Env, type InstallOutcome } from "./handler"
import { runInstall } from "./install"
import type { Grant } from "./plan"

export default handler

function randomSecret(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
}


// One object per Clerk user, so two clicks of "install" never run at once.
export class InstallDO extends DurableObject<Env> {
  async install(req: { sub: string; grant: Grant; accountId?: string }): Promise<InstallOutcome> {
    const clerk = createClerkClient({ secretKey: this.env.CLERK_SECRET_KEY })
    try {
      const value = await runInstall(
        this.env,
        {
          fetch: (input, init) => fetch(input, init),
          randomSecret,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
          setMetadata: async (sub, publicMetadata) => {
            await clerk.users.updateUserMetadata(sub, { publicMetadata })
          },
        },
        req,
      )
      return { ok: true, value }
    } catch (e) {
      if (e instanceof InstallError) return { ok: false, error: { code: e.code, message: e.message, status: e.status } }
      return { ok: false, error: { code: "internal", message: "The install failed. Try again.", status: 500 } }
    }
  }
}
