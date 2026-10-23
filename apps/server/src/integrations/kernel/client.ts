import * as Schema from "effect/Schema"
import Kernel, { APIConnectionError, APIError } from "@onkernel/sdk"

export type Mode = "headless" | "headful"

export type KernelErrorKind = "unauthorized" | "rate_limited" | "capacity" | "not_found" | "conflict" | "failed"

export class KernelError extends Schema.TaggedError<KernelError>()("KernelError", {
  kind: Schema.Literals(["unauthorized", "rate_limited", "capacity", "not_found", "conflict", "failed"]),
  message: Schema.String,
  retryAfter: Schema.optional(Schema.Number),
}) {}

export type CreatedBrowser = { sessionId: string; cdpUrl: string; liveUrl?: string }

export interface KernelClient {
  createBrowser(args: { headless: boolean; profile: string; timeoutSeconds: number }): Promise<CreatedBrowser>
  deleteBrowser(sessionId: string): Promise<void>
  listActive(): Promise<string[]>
  alive(sessionId: string): Promise<boolean>
  createProfile(name: string): Promise<void>
}

export const REJECTED = "Kernel rejected this key"

function classify(e: unknown): KernelError {
  if (e instanceof KernelError) return e
  if (e instanceof APIError && e.status !== undefined) {
    if (e.status === 401 || e.status === 403) return new KernelError({ kind: "unauthorized", message: REJECTED })
    if (e.status === 404) return new KernelError({ kind: "not_found", message: "Kernel has no such item" })
    if (e.status === 409) return new KernelError({ kind: "conflict", message: "Kernel already has this item" })
    if (e.status === 429) {
      const wait = Number(e.headers?.get("retry-after"))
      return new KernelError({
        kind: "rate_limited",
        message: "Kernel is busy",
        retryAfter: Number.isFinite(wait) && wait > 0 ? wait : undefined,
      })
    }
    if (e.status === 529) return new KernelError({ kind: "capacity", message: "Kernel is out of capacity" })
    return new KernelError({ kind: "failed", message: `Kernel answered ${e.status}` })
  }
  if (e instanceof APIConnectionError) return new KernelError({ kind: "failed", message: "Kernel did not answer" })
  return new KernelError({ kind: "failed", message: "Kernel failed" })
}

async function call<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op()
  } catch (e) {
    throw classify(e)
  }
}

export function sdkClient(apiKey: string, fetchImpl?: typeof fetch): KernelClient {
  const kernel = new Kernel({ apiKey, maxRetries: 0, timeout: 30_000, ...(fetchImpl ? { fetch: fetchImpl } : {}) })
  return {
    createBrowser: ({ headless, profile, timeoutSeconds }) =>
      call(async () => {
        const b = await kernel.browsers.create({
          headless,
          timeout_seconds: timeoutSeconds,
          profile: { name: profile, save_changes: true },
        })
        return {
          sessionId: b.session_id,
          cdpUrl: b.cdp_ws_url,
          ...(b.browser_live_view_url ? { liveUrl: b.browser_live_view_url } : {}),
        }
      }),
    deleteBrowser: (sessionId) => call(() => kernel.browsers.deleteByID(sessionId, { timeout: 60_000 })),
    listActive: () =>
      call(async () => {
        const page = await kernel.browsers.list({ status: "active" })
        return page.getPaginatedItems().map((b) => b.session_id)
      }),
    alive: async (sessionId) => {
      try {
        await call(() => kernel.browsers.retrieve(sessionId))
        return true
      } catch (e) {
        if (e instanceof KernelError && e.kind === "not_found") return false
        throw e
      }
    },
    createProfile: (name) => call(async () => void (await kernel.profiles.create({ name }))),
  }
}
