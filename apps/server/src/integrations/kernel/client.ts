// The key is never put in an error or a log.
// The SDK adds 46 KB gzipped to the server bundle (architecture section 27).

import Kernel, { APIConnectionError, APIError } from "@onkernel/sdk"

export type Mode = "headless" | "headful"

export type KernelErrorKind = "unauthorized" | "rate_limited" | "capacity" | "not_found" | "conflict" | "failed"

export class KernelError extends Error {
  constructor(
    readonly kind: KernelErrorKind,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message)
  }
}

export type CreatedBrowser = { sessionId: string; cdpUrl: string; liveUrl?: string }

export type CurlRequest = {
  url: string
  method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE"
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}

export type CurlResponse = { status: number; headers: Record<string, string>; body: string; truncated: boolean }

/** Body text kept from a curl response, in characters. */
export const CURL_BODY_CAP = 20_000

export interface KernelClient {
  createBrowser(args: { headless: boolean; profile: string; timeoutSeconds: number }): Promise<CreatedBrowser>
  deleteBrowser(sessionId: string): Promise<void>
  listActive(): Promise<string[]>
  alive(sessionId: string): Promise<boolean>
  /** HTTP through the browser's own network stack, cookies and proxy included. Body capped at `CURL_BODY_CAP`. */
  curl(sessionId: string, req: CurlRequest): Promise<CurlResponse>
  writeFile(sessionId: string, path: string, bytes: Uint8Array): Promise<void>
  readFile(sessionId: string, path: string): Promise<Uint8Array>
  /** Names of the files, not folders, directly in `path`. A missing folder is `not_found`. */
  listFiles(sessionId: string, path: string): Promise<string[]>
  createProfile(name: string): Promise<void>
  deleteProfile(name: string): Promise<void>
}

export const REJECTED = "Kernel rejected this key"

function classify(e: unknown): KernelError {
  if (e instanceof KernelError) return e
  if (e instanceof APIError && e.status !== undefined) {
    if (e.status === 401 || e.status === 403) return new KernelError("unauthorized", REJECTED)
    if (e.status === 404) return new KernelError("not_found", "Kernel has no such item")
    if (e.status === 409) return new KernelError("conflict", "Kernel already has this item")
    if (e.status === 429) {
      const wait = Number(e.headers?.get("retry-after"))
      return new KernelError("rate_limited", "Kernel is busy", Number.isFinite(wait) && wait > 0 ? wait : undefined)
    }
    if (e.status === 529) return new KernelError("capacity", "Kernel is out of capacity")
    return new KernelError("failed", `Kernel answered ${e.status}`)
  }
  if (e instanceof APIConnectionError) return new KernelError("failed", "Kernel did not answer")
  return new KernelError("failed", "Kernel failed")
}

async function call<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op()
  } catch (e) {
    throw classify(e)
  }
}

export function sdkClient(apiKey: string): KernelClient {
  // Retries are the lease's job: it knows which 429 is worth waiting for.
  const kernel = new Kernel({ apiKey, maxRetries: 0, timeout: 30_000 })
  return {
    createBrowser: ({ headless, profile, timeoutSeconds }) =>
      call(async () => {
        const b = await kernel.browsers.create({
          headless,
          timeout_seconds: timeoutSeconds,
          profile: { name: profile, save_changes: true },
        })
        return { sessionId: b.session_id, cdpUrl: b.cdp_ws_url, ...(b.browser_live_view_url ? { liveUrl: b.browser_live_view_url } : {}) }
      }),
    curl: (sessionId, req) =>
      call(async () => {
        const res = await kernel.browsers.curl(sessionId, {
          url: req.url,
          method: req.method ?? "GET",
          ...(req.headers ? { headers: req.headers } : {}),
          ...(req.body !== undefined ? { body: req.body } : {}),
          ...(req.timeoutMs !== undefined ? { timeout_ms: req.timeoutMs } : {}),
          response_encoding: "utf8",
        })
        const headers = Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, v.join(", ")]))
        return { status: res.status, headers, body: res.body.slice(0, CURL_BODY_CAP), truncated: res.body.length > CURL_BODY_CAP }
      }),
    // A save takes about 3 s, so this waits longer than the other calls.
    writeFile: (sessionId, path, bytes) => call(() => kernel.browsers.fs.writeFile(sessionId, bytes, { path, mode: "0644" })),
    readFile: (sessionId, path) =>
      call(async () => new Uint8Array(await (await kernel.browsers.fs.readFile(sessionId, { path })).arrayBuffer())),
    listFiles: (sessionId, path) =>
      call(async () => (await kernel.browsers.fs.listFiles(sessionId, { path })).filter((f) => !f.is_dir).map((f) => f.name)),
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
    deleteProfile: (name) => call(() => kernel.profiles.delete(name)),
  }
}
