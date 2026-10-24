import type { FetchLike } from "@kiko/durable/cloudflare"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { failed, type InstallFailed } from "./failure"
import type { Pointer } from "./scan"

export type ClerkUser = { readonly email: string | null; readonly pointer: Pointer | null; readonly url: string | null }

export class Clerk extends Context.Service<
  Clerk,
  {
    readonly user: (id: string) => Effect.Effect<ClerkUser | null, InstallFailed>
    readonly point: (id: string, pointer: Pointer | null) => Effect.Effect<void, InstallFailed>
  }
>()("@kiko/installer/Clerk") {}

const CLERK_API = "https://api.clerk.com/v1"

const PointerSchema = Schema.Struct({
  v: Schema.Literal(1),
  url: Schema.String,
  accountId: Schema.String,
  script: Schema.String,
})

const UserSchema = Schema.Struct({
  primary_email_address_id: Schema.optional(Schema.NullOr(Schema.String)),
  email_addresses: Schema.Array(Schema.Struct({ id: Schema.String, email_address: Schema.String })),
  public_metadata: Schema.Record(Schema.String, Schema.Unknown),
})

const decodeUser = Schema.decodeUnknownOption(UserSchema)
const decodePointer = Schema.decodeUnknownOption(PointerSchema)

function userOf(body: unknown): ClerkUser | null {
  const user = decodeUser(body)
  if (Option.isNone(user)) return null
  const { email_addresses: emails, primary_email_address_id: primary, public_metadata: metadata } = user.value
  const email = emails.find((address) => address.id === primary) ?? emails[0]
  const legacyUrl = metadata.backendUrl
  return {
    email: email?.email_address ?? null,
    pointer: Option.getOrNull(decodePointer(metadata.kiko)),
    url: typeof legacyUrl === "string" ? legacyUrl : null,
  }
}

export const clerkRest = (options: { readonly secretKey: string; readonly fetch: FetchLike }): Clerk["Service"] => {
  const call = (path: string, init: RequestInit = {}) =>
    Effect.tryPromise({
      try: () =>
        options.fetch(`${CLERK_API}${path}`, {
          ...init,
          headers: { Authorization: `Bearer ${options.secretKey}`, "Content-Type": "application/json" },
        }),
      catch: () => failed("internal", `Clerk could not be reached (${init.method ?? "GET"} ${path})`),
    })
  return Clerk.of({
    user: (id) =>
      Effect.gen(function* () {
        const response = yield* call(`/users/${encodeURIComponent(id)}`)
        if (response.status === 404) return null
        if (!response.ok) return yield* failed("internal", `Clerk answered ${response.status} for a user read`)
        return userOf(yield* Effect.promise(() => response.json().catch(() => null)))
      }),
    point: (id, pointer) =>
      Effect.gen(function* () {
        const response = yield* call(`/users/${encodeURIComponent(id)}/metadata`, {
          method: "PATCH",
          body: JSON.stringify({
            public_metadata: { kiko: pointer, backendUrl: null, accountId: null, version: null },
          }),
        })
        if (!response.ok && !(pointer === null && response.status === 404))
          return yield* failed("internal", `Clerk answered ${response.status} for a pointer write`)
      }),
  })
}
