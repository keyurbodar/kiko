import { type Keyring, open, seal } from "@kiko/durable/crypto"
import { type Cloudflare, CloudflareError, cloudflare, listScripts, scriptBindings } from "@kiko/durable/cloudflare"
import type { FetchLike } from "@kiko/durable/cloudflare"
import { installBuilder } from "@kiko/durable/builder-install"
import { sha256Hex } from "@kiko/durable/hash"
import { loadVerifiedRelease, ReleaseRefused } from "@kiko/durable/release-load"
import {
  buildMetadata,
  keptBindings,
  ReleasePlanRefused,
  selectMigrations,
  uploadBody,
} from "@kiko/durable/release-plan"
import { UpdateErrorCode } from "@kiko/protocol"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

export type CfGrant = {
  kind: "oauth" | "token"
  accountId: string
  scriptName: string
  clientId?: string
  accessToken?: string
  refreshToken?: string
  token?: string
}

export type UpdateConfig = { releaseBase: string; publicKey: string; cfApi: string; oauthUrl: string }

export class UpdateFailed extends Schema.TaggedError<UpdateFailed>()("UpdateFailed", {
  code: UpdateErrorCode,
  message: Schema.String,
}) {}

export interface GrantStore {
  readonly load: Effect.Effect<CfGrant | null>
  readonly save: (grant: CfGrant) => Effect.Effect<void>
}

export interface UpdateDeps {
  readonly fetch: FetchLike
  readonly config: UpdateConfig
  readonly grants: GrantStore
}

const RECONNECT = "Reconnect Cloudflare, then try again."

function parseGrant(text: string | null | undefined): CfGrant | null {
  if (!text) return null
  try {
    const g = JSON.parse(text) as Partial<CfGrant>
    const text1 = (v: unknown): v is string => typeof v === "string" && v.length > 0
    if (!text1(g.accountId) || !text1(g.scriptName)) return null
    if (g.kind === "token" && text1(g.token)) return g as CfGrant
    if (g.kind === "oauth" && text1(g.clientId) && text1(g.refreshToken)) return g as CfGrant
    return null
  } catch {
    return null
  }
}

const refused = () =>
  new UpdateFailed({ code: "grant_refused", message: `Cloudflare refused the saved sign-in. ${RECONNECT}` })

const unreachable = () =>
  new UpdateFailed({ code: "cloudflare_error", message: "Cloudflare could not be reached. Try again." })

const fromCloudflare = (error: CloudflareError) => {
  if (error.status === 401 || error.status === 403) return refused()
  return error.status === 0
    ? unreachable()
    : new UpdateFailed({ code: "cloudflare_error", message: `Cloudflare did not accept the update: ${error.said}` })
}

const accessToken = Effect.fn("SelfUpdate.accessToken")(function* (deps: UpdateDeps, grant: CfGrant) {
  if (grant.kind === "token") return grant.token as string
  const response = yield* Effect.tryPromise({
    try: () =>
      deps.fetch(deps.config.oauthUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: grant.refreshToken as string,
          client_id: grant.clientId as string,
        }),
      }),
    catch: unreachable,
  })
  const body = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<{ access_token?: string; refresh_token?: string } | null>,
  )
  if (!response.ok || !body?.access_token) return yield* refused()
  yield* deps.grants.save({
    ...grant,
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? grant.refreshToken,
  })
  return body.access_token
})

const loadRelease = (deps: UpdateDeps, version: string) =>
  Effect.tryPromise({
    try: () =>
      loadVerifiedRelease({ baseUrl: deps.config.releaseBase, publicKey: deps.config.publicKey, version }, (url) =>
        deps.fetch(url),
      ),
    catch: (error) =>
      error instanceof ReleaseRefused
        ? new UpdateFailed({ code: error.code, message: error.message })
        : new UpdateFailed({ code: "release_unavailable", message: "The release could not be loaded. Try again." }),
  })

const upload = Effect.fn("SelfUpdate.upload")(function* (
  cf: Cloudflare,
  grant: CfGrant,
  release: Effect.Success<ReturnType<typeof loadRelease>>,
) {
  const own = (yield* listScripts(cf, grant.accountId)).find((script) => script.id === grant.scriptName)
  if (!own)
    return yield* new UpdateFailed({
      code: "grant_refused",
      message: `This backend was not found in the Cloudflare account it was installed from. ${RECONNECT}`,
    })
  const existing = yield* scriptBindings(cf, grant.accountId, grant.scriptName)
  const builder = yield* installBuilder(cf, grant.accountId, grant.scriptName, release)
  const metadata = yield* Effect.try({
    try: () =>
      buildMetadata(
        release.manifest,
        selectMigrations(release.manifest.migrations, own.migration_tag ?? null),
        keptBindings(existing, builder ? [builder] : []),
      ),
    catch: (error) =>
      new UpdateFailed({
        code: "release_untrusted",
        message: error instanceof ReleasePlanRefused ? error.message : "The release does not fit this backend.",
      }),
  })
  yield* cf.call(`/accounts/${grant.accountId}/workers/scripts/${grant.scriptName}`, {
    method: "PUT",
    body: uploadBody(release.manifest, release.files, metadata),
  })
})

export const runUpdate = Effect.fn("SelfUpdate.run")(function* (deps: UpdateDeps, version: string) {
  const release = yield* loadRelease(deps, version)
  const grant = yield* deps.grants.load
  if (!grant)
    return yield* new UpdateFailed({
      code: "no_grant",
      message: `Kiko has no Cloudflare sign-in saved. ${RECONNECT}`,
    })
  const token = yield* accessToken(deps, grant)
  yield* upload(cloudflare({ token, fetch: deps.fetch, api: deps.config.cfApi }), grant, release).pipe(
    Effect.catchTags({ CloudflareError: (error) => Effect.fail(fromCloudflare(error)) }),
  )
})

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
const AAD = "cf-grant"

const StoredGrant = Schema.Struct({
  fingerprint: Schema.String,
  sealed: Schema.Struct({ k: Schema.Number, iv: Schema.String, ct: Schema.String }),
})
const decodeStored = Schema.decodeUnknownOption(Schema.fromJsonString(StoredGrant))

export interface GrantCell {
  readonly read: () => string | null
  readonly write: (text: string) => void
}

export function grantStore(input: {
  readonly keyring: Keyring
  readonly userId: string
  readonly env: string | undefined
  readonly cell: GrantCell
}): GrantStore {
  const fingerprint = Effect.promise(() => sha256Hex(input.env ?? ""))
  return {
    load: Effect.gen(function* () {
      if (!input.env) return null
      const stored = decodeStored(input.cell.read())
      if (Option.isSome(stored) && stored.value.fingerprint === (yield* fingerprint)) {
        const { k, iv, ct } = stored.value.sealed
        const opened = yield* Effect.promise(() =>
          open(input.keyring, input.userId, AAD, { kekVersion: k, iv: unb64(iv), ciphertext: unb64(ct) }).then(
            parseGrant,
            () => null,
          ),
        )
        if (opened) return opened
      }
      return parseGrant(input.env)
    }),
    save: (grant) =>
      Effect.gen(function* () {
        const sealed = yield* Effect.promise(() => seal(input.keyring, input.userId, AAD, JSON.stringify(grant)))
        input.cell.write(
          JSON.stringify({
            fingerprint: yield* fingerprint,
            sealed: { k: sealed.kekVersion, iv: b64(sealed.iv), ct: b64(sealed.ciphertext) },
          }),
        )
      }),
  }
}
