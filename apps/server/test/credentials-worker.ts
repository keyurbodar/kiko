import { DurableObject } from "cloudflare:workers"
import type { Keyring } from "@kiko/durable/crypto"
import { CredentialVault, userIdFromObjectName } from "../src/user/credentials"
import { OWNER_STEPS } from "../src/owner/schema"
import { migrate } from "@kiko/durable/migrate"
import { OwnerDO } from "../src/owner/owner-do"
import { ownerName } from "../src/lib/names"

export { OwnerDO }

type Env = { OWNER: DurableObjectNamespace<OwnerDO>; VAULT: DurableObjectNamespace<VaultDO> }

type VaultCall = { keyring: Keyring; op: "connect" | "read" | "versions"; provider?: string; apiKey?: string }

export class VaultDO extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never)
    migrate(ctx.storage, OWNER_STEPS)
  }

  async call({ keyring, op, provider, apiKey }: VaultCall): Promise<unknown> {
    const vault = new CredentialVault(this.ctx.storage.sql, keyring, userIdFromObjectName(this.ctx.id.name))
    if (op === "connect") return vault.connect(provider!, apiKey)
    if (op === "read") return vault.read(provider!)
    return this.ctx.storage.sql.exec("SELECT provider_id, kek_version FROM credentials ORDER BY provider_id").toArray()
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const [, kind, user, extra] = new URL(request.url).pathname.split("/")
    if (kind === "log") {
      console.log(`log line ${extra}`)
      return new Response("ok")
    }
    try {
      if (kind === "vault") {
        const stub = env.VAULT.get(env.VAULT.idFromName(`user:${user}`))
        const result = await stub.call((await request.json()) as VaultCall)
        return Response.json({ result: result ?? null })
      }
      const stub = env.OWNER.get(env.OWNER.idFromName(ownerName(user!)))
      const { method, args } = await request.json<{ method: Parameters<OwnerDO["userCall"]>[0]; args: Parameters<OwnerDO["userCall"]>[1] }>()
      const result = await stub.userCall(method, args)
      console.log("rpc", method, JSON.stringify(result))
      return Response.json({ result: result ?? null })
    } catch (e) {
      console.error("rpc failed", String(e))
      return Response.json({ error: String(e) }, { status: 500 })
    }
  },
}
