import { DurableObject } from "cloudflare:workers"
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context"
import type { Storage } from "@earendil-works/pi-durable"
import { JournalStorage, JOURNAL_STEPS } from "@kiko/agent/journal"

export type Call = { method: keyof Storage; args: (["undefined"] | ["value", unknown])[]; reopen: boolean }
export type Wire = ["undefined"] | ["scalar", string | number | boolean | null] | ["array", Wire[]] | ["object", [string, Wire][]]
export type Reply = { ok: true; value: Wire } | { ok: false; message: string }

function pack(value: unknown): Wire {
  if (value === undefined) return ["undefined"]
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return ["scalar", value]
  if (Array.isArray(value)) return ["array", value.map(pack)]
  return ["object", Object.entries(value).map(([key, item]) => [key, pack(item)])]
}

export class T extends DurableObject {
  private journal?: JournalStorage
  private closed = false

  async fetch(request: Request): Promise<Response> {
    const { method, args, reopen }: Call = await request.json()
    try {
      if (!this.journal) {
        for (const step of JOURNAL_STEPS) {
          if (typeof step === "string") this.ctx.storage.sql.exec(step)
          else step(this.ctx.storage.sql)
        }
        this.journal = JournalStorage.open(this.ctx.storage, "conformance")
      }
      const mutating = method === "commit" || method === "mintId" || method === "close"
      // Keep the live allocator, including uncommitted IDs, while every replay read opens from SQL.
      const storage = reopen && !mutating && !this.closed ? JournalStorage.open(this.ctx.storage, "conformance") : this.journal
      const parameters = args.map((arg) => arg[0] === "undefined" ? undefined : arg[1])
      if (method !== "mintId") parameters.push(BACKGROUND_CONTEXT)
      const value: unknown = await Reflect.apply(storage[method], storage, parameters)
      if (method === "close") this.closed = true
      return Response.json({ ok: true, value: pack(value) } satisfies Reply)
    } catch (error) {
      return Response.json({ ok: false, message: error instanceof Error ? error.message : String(error) } satisfies Reply)
    }
  }
}

export default { fetch: () => new Response("not found", { status: 404 }) }
