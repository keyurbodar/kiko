import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4"

export class CloudflareError extends Schema.TaggedError<CloudflareError>()("CloudflareError", {
  status: Schema.Number,
  codes: Schema.Array(Schema.Number),
  said: Schema.String,
  request: Schema.String,
}) {
  override get message(): string {
    return `${this.said} (${this.request})`
  }
}

export interface ScriptBinding {
  readonly name: string
  readonly type: string
  readonly text?: string
  readonly class_name?: string
}

export interface ScriptSummary {
  readonly id: string
  readonly migration_tag?: string
  readonly modified_on?: string
}

export interface Cloudflare {
  readonly call: <T>(path: string, init?: RequestInit) => Effect.Effect<T, CloudflareError>
}

type Answer<T> = { success?: boolean; result?: T; errors?: { code?: unknown; message?: unknown }[] }

export function cloudflare(options: {
  readonly token: string
  readonly fetch: FetchLike
  readonly api?: string
}): Cloudflare {
  const api = options.api ?? CLOUDFLARE_API
  return {
    call: <T>(path: string, init: RequestInit = {}) =>
      Effect.gen(function* () {
        const request = `${init.method ?? "GET"} ${path.replace(/\/accounts\/\w+/, "/accounts/…")}`
        const headers = new Headers(init.headers)
        headers.set("Authorization", `Bearer ${options.token}`)
        const response = yield* Effect.tryPromise({
          try: () => options.fetch(`${api}${path}`, { ...init, headers }),
          catch: () => new CloudflareError({ status: 0, codes: [], said: "Cloudflare could not be reached.", request }),
        })
        const body = yield* Effect.promise(() => response.json().catch(() => null) as Promise<Answer<T> | null>)
        if (response.ok && body?.success) return body.result as T
        const errors = body?.errors ?? []
        return yield* new CloudflareError({
          status: response.status,
          codes: errors.flatMap((error) => (typeof error.code === "number" ? [error.code] : [])),
          said:
            errors.map((error) => error.message).find((said): said is string => typeof said === "string") ??
            `Cloudflare answered ${response.status}.`,
          request,
        })
      }),
  }
}

export const json = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
})

export const listScripts = (cf: Cloudflare, accountId: string) =>
  cf.call<ScriptSummary[]>(`/accounts/${accountId}/workers/scripts`)

export const scriptBindings = (cf: Cloudflare, accountId: string, script: string) =>
  cf
    .call<{ bindings?: ScriptBinding[] }>(`/accounts/${accountId}/workers/scripts/${script}/settings`)
    .pipe(Effect.map((settings) => settings.bindings ?? []))
