import { createClerkClient } from "@clerk/backend"
import { DurableObject } from "cloudflare:workers"
import { installFailure } from "./cf"
import handler, { type Env, type InstallOutcome } from "./handler"
import { type OAuthTokens, runInstall } from "./install"
import type { Grant } from "./plan"

export default handler

function randomSecret(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
}


/** Long enough to pick an account. Nothing else is kept. */
const CODE_KEEP_MS = 10 * 60_000

async function sha(text: string): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).toString("hex")
}

// One object per Clerk user, so two clicks of "install" never run at once.
export class Installer extends DurableObject<Env> {
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
            take: async (code) => {
              const key = `code:${await sha(code)}`
              const kept = await this.ctx.storage.get<{ tokens: OAuthTokens; at: number }>(key)
              if (!kept) return undefined
              await this.ctx.storage.delete(key)
              return Date.now() - kept.at < CODE_KEEP_MS ? kept.tokens : undefined
            },
            put: async (code, tokens) => {
              const now = Date.now()
              // The stored entry expires on its own timestamp, so the only stale keys are ones older than that.
              // One delete for all of them keeps this to a single write instead of a deleteAll on every install.
              const stale = [...(await this.ctx.storage.list<{ at: number }>({ prefix: "code:" }))].filter(([, kept]) => now - kept.at >= CODE_KEEP_MS).map(([key]) => key)
              if (stale.length > 0) await this.ctx.storage.delete(stale)
              await this.ctx.storage.put(`code:${await sha(code)}`, { tokens, at: now })
            },
          },
        },
        req,
      )
      return { ok: true, value }
    } catch (e) {
      const failed = installFailure(e)
      if (!failed) {
        const said = e instanceof Error ? e.message : String(e)
        console.error(`install failed: ${said}`)
        return { ok: false, error: { code: "internal", message: "The install failed. Try again.", status: 500, detail: said } }
      }
      console.error(`install failed: ${failed.code} ${failed.detail ?? failed.message}`)
      return { ok: false, error: { code: failed.code, message: failed.message, status: failed.status, ...(failed.detail ? { detail: failed.detail } : {}), ...(failed.accounts ? { accounts: failed.accounts } : {}) } }
    }
  }
}
