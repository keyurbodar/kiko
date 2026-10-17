import { DurableObject } from "cloudflare:workers"
import { getBuiltinModelDataGeneratedAt } from "@earendil-works/pi-ai/providers/all"
import { migrate } from "@kiko/durable/migrate"
import { findProvider, overlayFor, overlayRevision } from "../src/models/catalog"
import { readOverlay, readState, restoreOverlay, syncCatalog } from "../src/models/sync"
import { USER_STEPS } from "../src/user/schema"

export class CatalogDO extends DurableObject {
  #sql: SqlStorage
  #now = 1_000

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never)
    migrate(ctx.storage, USER_STEPS)
    this.#sql = ctx.storage.sql
  }

  /** A remote model: a copy of a bundled opencode-go model under a new id, so its api is one the provider streams. */
  model(id: string, price = 1) {
    const base = findProvider("opencode-go")!.getModels()[0]!
    return { ...base, id, name: id, cost: { ...base.cost, input: price } }
  }

  async sync(reply: { status: number; etag?: string; lastModified?: string; body?: unknown; throws?: boolean }): Promise<{ changed: boolean; seen: { url: string; ifNoneMatch: string | null }[] }> {
    this.#now += 60_000
    const seen: { url: string; ifNoneMatch: string | null }[] = []
    const changed = await syncCatalog({
      sql: this.#sql,
      now: () => this.#now,
      fetch: async (url, init) => {
        seen.push({ url, ifNoneMatch: new Headers(init.headers).get("if-none-match") })
        if (reply.throws) throw new Error("offline")
        const headers = new Headers()
        if (reply.etag) headers.set("etag", reply.etag)
        if (reply.lastModified) headers.set("last-modified", reply.lastModified === "newer" ? new Date((getBuiltinModelDataGeneratedAt() ?? 0) + 86_400_000).toUTCString() : reply.lastModified)
        return new Response(reply.status === 304 ? null : JSON.stringify(reply.body ?? {}), { status: reply.status, headers })
      },
    })
    return { changed, seen }
  }

  state() {
    return {
      state: readState(this.#sql),
      stored: Object.fromEntries(Object.entries(readOverlay(this.#sql)).map(([id, models]) => [id, models.map((m) => m.id)])),
      live: overlayFor("opencode-go").map((m) => m.id),
      revision: overlayRevision(),
    }
  }

  restart() {
    restoreOverlay(this.#sql)
  }
}

export default {
  async fetch(request: Request, env: { CATALOG: DurableObjectNamespace<CatalogDO> }) {
    const [, name] = new URL(request.url).pathname.split("/")
    const stub = env.CATALOG.get(env.CATALOG.idFromName(name!))
    const { method, args } = (await request.json()) as { method: string; args: unknown[] }
    const result = await (stub as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]!(...args)
    return Response.json({ result: result ?? null })
  },
}
