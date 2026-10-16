import { createClerkClient } from "@clerk/backend"
import { DurableObject } from "cloudflare:workers"
import { InstallError } from "./cf"
import handler, { type Env, type InstallOutcome } from "./handler"
import { type OAuthTokens, runInstall } from "./install"
import type { Grant } from "./plan"

export default handler

function randomSecret(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
}


/** Long enough to pick an account after the first answer. */
const CODE_KEEP_MS = 10 * 60_000

async function sha(text: string): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).toString("hex")
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
          codes: {
            get: async (code) => {
              const kept = await this.ctx.storage.get<{ tokens: OAuthTokens; at: number }>(`code:${await sha(code)}`)
              return kept && Date.now() - kept.at < CODE_KEEP_MS ? kept.tokens : undefined
            },
            put: async (code, tokens) => {
              for (const key of (await this.ctx.storage.list({ prefix: "code:" })).keys()) await this.ctx.storage.delete(key)
              await this.ctx.storage.put(`code:${await sha(code)}`, { tokens, at: Date.now() })
            },
          },
        },
        req,
      )
      return { ok: true, value }
    } catch (e) {
      if (e instanceof InstallError) {
        console.error(`install failed: ${e.code} ${e.detail ?? e.message}`)
        return { ok: false, error: { code: e.code, message: e.message, status: e.status, ...(e.detail ? { detail: e.detail } : {}), ...(e.accounts ? { accounts: e.accounts } : {}) } }
      }
      console.error(`install failed: ${e instanceof Error ? e.message : String(e)}`)
      return { ok: false, error: { code: "internal", message: "The install failed. Try again.", status: 500, detail: e instanceof Error ? e.message : String(e) } }
    }
  }
}
