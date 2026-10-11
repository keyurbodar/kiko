import { DurableObject } from "cloudflare:workers"
import { keyringFromEnv } from "@yuki/durable/crypto"
import { ExtensionError, ExtensionStore } from "../src/user/extensions"

type Env = { STORE: DurableObjectNamespace<StoreDO>; CREDENTIALS_KEK: string }

const PUBLIC_IP = "93.184.215.14"

export class StoreDO extends DurableObject<Env> {
  sent: { url: string; method: string; headers: Record<string, string>; body: string | null }[] = []
  triggers: string[] = []
  events: string[] = []
  #store?: ExtensionStore

  get store(): ExtensionStore {
    this.#store ??= new ExtensionStore(
      this.ctx.storage.sql,
      () => keyringFromEnv(this.env),
      () => "user-1",
      (e) => this.events.push(e.t),
      {
        create: async (t) => void this.triggers.push(`create ${t.createdBy} ${t.rrule} ${t.text}`),
        cancelBy: async (by) => {
          if (by === "ext:boom") throw new Error("the scheduler is down")
          this.triggers.push(`cancel ${by}`)
        },
        fallback: () => ({ roomId: "0190f5e2-7c3a-7b4d-8e9f-0123456789ab" as never, target: "yuki" }),
      },
      () => [],
      async (url, init) => {
        if (url.startsWith("https://cloudflare-dns.com/")) {
          const type = new URL(url).searchParams.get("type")
          return Response.json({ Status: 0, Answer: type === "A" ? [{ type: 1, data: PUBLIC_IP }] : [] })
        }
        const headers: Record<string, string> = {}
        new Headers(init.headers).forEach((v, k) => (headers[k] = v))
        const body = typeof init.body === "string" ? init.body : null
        this.sent.push({ url, method: init.method ?? "GET", headers, body })
        return Response.json({ url, headers, body }, { headers: { "set-cookie": "a=b" } })
      },
    )
    return this.#store
  }

  async call(op: string, args: unknown[]): Promise<unknown> {
    try {
      const fn = (this.store as unknown as Record<string, (...a: unknown[]) => unknown>)[op]
      if (!fn) throw new Error(`no op ${op}`)
      return { ok: true, value: await fn.apply(this.store, args) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), problems: e instanceof ExtensionError ? e.problems : undefined }
    }
  }

  async seen() {
    return { sent: this.sent, triggers: this.triggers, events: this.events }
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const [, user, what] = new URL(request.url).pathname.split("/")
    const stub = env.STORE.get(env.STORE.idFromName(user!))
    if (what === "seen") return Response.json(await stub.seen())
    const { op, args } = (await request.json()) as { op: string; args: unknown[] }
    return Response.json(await stub.call(op, args))
  },
}
