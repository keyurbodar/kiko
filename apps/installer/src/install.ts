import {
  type Cloudflare,
  type CloudflareError,
  cloudflare,
  type FetchLike,
  json,
  listScripts,
  scriptBindings,
} from "@kiko/durable/cloudflare"
import { loadVerifiedRelease, ReleaseRefused } from "@kiko/durable/release-load"
import {
  buildMetadata,
  keptBindings,
  ReleasePlanRefused,
  selectMigrations,
  type UploadBinding,
  uploadBody,
} from "@kiko/durable/release-plan"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Schedule from "effect/Schedule"
import * as Semaphore from "effect/Semaphore"
import { Clerk } from "./clerk"
import { failed, fromCloudflare, InstallFailed } from "./failure"
import type { Grant, StoredGrant } from "./plan"
import { classify, DEFAULT_SCRIPT, isKikoName, maskEmail, type Pointer, type Scan, type Script, targetOf } from "./scan"

export class Http extends Context.Service<Http, { readonly fetch: FetchLike }>()("@kiko/installer/Http") {}

export class InstallerConfig extends Context.Service<
  InstallerConfig,
  {
    readonly oauthClientId: string
    readonly releaseBase: string
    readonly releasePublicKey: string
    readonly random: () => Uint8Array
  }
>()("@kiko/installer/InstallerConfig") {}

export type OAuthTokens = { readonly accessToken: string; readonly refreshToken?: string }

export class CodeCache extends Context.Service<
  CodeCache,
  {
    readonly recall: (code: string) => Effect.Effect<OAuthTokens | null, InstallFailed>
    readonly remember: (code: string, tokens: OAuthTokens) => Effect.Effect<void, InstallFailed>
    readonly forget: (code: string) => Effect.Effect<void, InstallFailed>
  }
>()("@kiko/installer/CodeCache") {}

export type Decision = "take_over" | "start_fresh"

export type InstallRequest = {
  readonly sub: string
  readonly grant: Grant
  readonly accountId?: string
  readonly decision?: Decision
}

export type Account = { readonly id: string; readonly name: string }

export type Found = {
  readonly script: string
  readonly owner: { readonly _tag: "Other"; readonly hint: string } | { readonly _tag: "Unknown" }
  readonly keepable: boolean
}

export type InstallAnswer =
  | { readonly _tag: "Installed"; readonly backendUrl: string; readonly version: string }
  | { readonly _tag: "ChooseAccount"; readonly accounts: ReadonlyArray<Account> }
  | { readonly _tag: "Decide"; readonly found: Found }

type Access = {
  readonly token: string
  readonly grant: Omit<StoredGrant, "accountId" | "scriptName">
  readonly code: string | null
}

type Release = Effect.Success<ReturnType<typeof loadRelease>>

type Place = { readonly _tag: "Place"; readonly account: Account; readonly scans: ReadonlyArray<Scan> }

type Deployment = {
  readonly _tag: "Deployment"
  readonly name: string
  readonly existing: Script | null
  readonly deleteFirst: boolean
  readonly rotate: boolean
  readonly previousOwner: string | null
}

type Claimable = Extract<Scan, { _tag: "Other" | "Unclaimed" }>

const OAUTH_TOKEN_URL = "https://dash.cloudflare.com/oauth2/token"
const RESOLVERS = ["https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"]
const POLL = Schedule.spaced("3 seconds")
const SKIPPABLE: ReadonlySet<string> = new Set(["no_permission", "cloudflare_error"])

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")

const hex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")

const exchange = Effect.fn("Installer.exchange")(function* (grant: Extract<Grant, { kind: "oauth" }>) {
  const { fetch } = yield* Http
  const config = yield* InstallerConfig
  const response = yield* Effect.tryPromise({
    try: () =>
      fetch(OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: grant.code,
          redirect_uri: grant.redirectUri,
          client_id: config.oauthClientId,
          code_verifier: grant.verifier,
        }),
      }),
    catch: () => failed("cloudflare_down", "the Cloudflare sign-in could not be reached"),
  })
  const body = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<{ access_token?: string; refresh_token?: string } | null>,
  )
  if (!response.ok || !body?.access_token)
    return yield* failed("grant_invalid", `the code exchange answered ${response.status}`)
  return { accessToken: body.access_token, ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}) }
})

const authorize = Effect.fn("Installer.authorize")(function* (grant: Grant) {
  if (grant.kind === "token")
    return { token: grant.token, grant: { kind: "token", token: grant.token }, code: null } satisfies Access
  const cache = yield* CodeCache
  const config = yield* InstallerConfig
  const kept = yield* cache.recall(grant.code)
  const tokens = kept ?? (yield* exchange(grant))
  if (!kept) yield* cache.remember(grant.code, tokens)
  return {
    token: tokens.accessToken,
    grant: {
      kind: "oauth",
      clientId: config.oauthClientId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    },
    code: grant.code,
  } satisfies Access
})

const accountsOf = (cf: Cloudflare, kind: Grant["kind"]) =>
  cf.call<{ id: string; name?: string }[]>("/accounts").pipe(
    Effect.mapError((error) => {
      const failure = fromCloudflare(error)
      return kind === "oauth" && failure.code === "bad_token" ? failed("grant_invalid", failure.detail) : failure
    }),
    Effect.map((accounts) => accounts.map((account) => ({ id: account.id, name: account.name ?? account.id }))),
  )

const scanAccount = (cf: Cloudflare, account: Account, sub: string): Effect.Effect<Place, CloudflareError> =>
  listScripts(cf, account.id).pipe(
    Effect.flatMap((scripts) =>
      Effect.forEach(
        scripts.filter((script) => isKikoName(script.id)),
        (script) =>
          scriptBindings(cf, account.id, script.id).pipe(
            Effect.map((bindings) =>
              classify(
                { name: script.id, tag: script.migration_tag ?? null, modified: script.modified_on ?? "", bindings },
                sub,
              ),
            ),
          ),
      ),
    ),
    Effect.map((scans) => ({ _tag: "Place", account, scans }) satisfies Place),
  )

const placeOf = Effect.fn("Installer.place")(function* (
  cf: Cloudflare,
  accounts: ReadonlyArray<Account>,
  request: InstallRequest,
  pointer: Pointer | null,
) {
  const candidates = request.accountId ? accounts.filter((account) => account.id === request.accountId) : accounts
  if (candidates.length === 0) return yield* failed("no_account")
  const results = yield* Effect.forEach(candidates, (account) =>
    scanAccount(cf, account, request.sub).pipe(Effect.mapError(fromCloudflare), Effect.result),
  )
  const usable = results.filter(Result.isSuccess).map((result) => result.success)
  const skipped = results.filter(Result.isFailure).map((result) => result.failure)
  const blocking = skipped.find((failure) => !SKIPPABLE.has(failure.code))
  if (blocking) return yield* blocking
  const [first, ...rest] = usable
  if (!first) return yield* skipped[0] ?? failed("no_account")
  if (rest.length === 0) return first
  const withMine = usable.filter((place) => place.scans.some((scan) => scan._tag === "Mine"))
  const chosen = withMine.find((place) => place.account.id === pointer?.accountId) ?? withMine[0]
  if (chosen) return chosen
  return { _tag: "ChooseAccount", accounts: usable.map((place) => place.account) } satisfies InstallAnswer
})

const loadRelease = Effect.fn("Installer.loadRelease")(function* () {
  const { fetch } = yield* Http
  const config = yield* InstallerConfig
  return yield* Effect.tryPromise({
    try: () =>
      loadVerifiedRelease({ baseUrl: config.releaseBase, publicKey: config.releasePublicKey }, (url) => fetch(url)),
    catch: (error) =>
      error instanceof ReleaseRefused
        ? new InstallFailed({ code: error.code, message: error.message })
        : failed("release_unavailable"),
  })
})

const keepable = (release: Release, script: Script) =>
  script.tag !== null && release.manifest.migrations.some((migration) => migration.tag === script.tag)

const foundOf = Effect.fn("Installer.found")(function* (scan: Claimable, release: Release) {
  const clerk = yield* Clerk
  const email = scan._tag === "Other" ? (yield* clerk.user(scan.ownerId))?.email : null
  return {
    script: scan.script.name,
    owner: email ? { _tag: "Other", hint: maskEmail(email) } : { _tag: "Unknown" },
    keepable: keepable(release, scan.script),
  } satisfies Found
})

const deploymentFor = Effect.fn("Installer.deployment")(function* (
  place: Place,
  request: InstallRequest,
  pointer: Pointer | null,
  release: Release,
) {
  const target = targetOf(
    place.scans,
    (scan) => pointer?.accountId === place.account.id && pointer.script === scan.script.name,
  )
  yield* Effect.logInfo("install scan", {
    account: place.account.id,
    scans: place.scans.map((scan) => `${scan.script.name}:${scan._tag}:${scan.script.tag ?? "untagged"}`),
    target: target._tag,
    decision: request.decision ?? "none",
  })
  const deployment = (fields: Omit<Deployment, "_tag">): Deployment => ({ _tag: "Deployment", ...fields })
  if (target._tag === "Empty") {
    if (target.nameTaken) return yield* failed("name_taken")
    return deployment({ name: DEFAULT_SCRIPT, existing: null, deleteFirst: false, rotate: true, previousOwner: null })
  }
  const { script } = target
  if (target._tag === "Mine")
    return deployment({ name: script.name, existing: script, deleteFirst: false, rotate: false, previousOwner: null })
  const previousOwner = target._tag === "Other" ? target.ownerId : null
  if (request.decision === "start_fresh")
    return deployment({ name: script.name, existing: null, deleteFirst: true, rotate: true, previousOwner })
  if (request.decision === "take_over") {
    if (!keepable(release, script)) return yield* failed("not_keepable")
    return deployment({ name: script.name, existing: script, deleteFirst: false, rotate: true, previousOwner })
  }
  return { _tag: "Decide", found: yield* foundOf(target, release) } satisfies InstallAnswer
})

const ensureSubdomain = Effect.fn("Installer.subdomain")(function* (cf: Cloudflare, accountId: string) {
  const config = yield* InstallerConfig
  const path = `/accounts/${accountId}/workers/subdomain`
  const missingAsNull = <A>(effect: Effect.Effect<A, CloudflareError>) =>
    effect.pipe(
      Effect.mapError(fromCloudflare),
      Effect.catchIf(
        (failure) => failure.code === "cloudflare_error",
        () => Effect.succeed(null),
      ),
    )
  const current = yield* missingAsNull(cf.call<{ subdomain?: string } | null>(path))
  if (current?.subdomain) return { subdomain: current.subdomain, made: false }
  const made = yield* missingAsNull(
    Effect.suspend(() =>
      cf.call<{ subdomain?: string } | null>(
        path,
        json({ subdomain: `kiko-${hex(config.random()).slice(0, 8)}` }, "PUT"),
      ),
    ),
  ).pipe(
    Effect.filterOrFail(
      (answer): answer is { subdomain: string } => Boolean(answer?.subdomain),
      () => failed("no_subdomain"),
    ),
    Effect.retry({ times: 2, while: (failure) => failure.code === "no_subdomain" }),
  )
  return { subdomain: made.subdomain, made: true }
})

const upload = Effect.fn("Installer.upload")(function* (
  cf: Cloudflare,
  account: Account,
  deployment: Deployment,
  access: Access,
  release: Release,
  sub: string,
) {
  const config = yield* InstallerConfig
  const fresh = (name: string): UploadBinding => ({ type: "secret_text", name, text: base64url(config.random()) })
  const grant: StoredGrant = { ...access.grant, accountId: account.id, scriptName: deployment.name }
  const written: UploadBinding[] = [
    { type: "plain_text", name: "OWNER_ID", text: sub },
    { type: "secret_text", name: "CF_GRANT", text: JSON.stringify(grant) },
    ...(deployment.existing === null
      ? [fresh("SESSION_SECRET"), fresh("CREDENTIALS_KEK")]
      : deployment.rotate
        ? [fresh("SESSION_SECRET")]
        : []),
  ]
  const metadata = yield* Effect.try({
    try: () =>
      buildMetadata(
        release.manifest,
        selectMigrations(release.manifest.migrations, deployment.existing?.tag ?? null),
        keptBindings(deployment.existing?.bindings ?? [], written),
      ),
    catch: (error) =>
      error instanceof ReleasePlanRefused && error.reason === "unknown_migration"
        ? failed("not_keepable", error.message)
        : failed("release_untrusted", error instanceof Error ? error.message : undefined),
  })
  const script = `/accounts/${account.id}/workers/scripts/${deployment.name}`
  if (deployment.deleteFirst)
    yield* cf.call(`${script}?force=true`, { method: "DELETE" }).pipe(Effect.mapError(fromCloudflare))
  yield* cf.call(script, { method: "PUT", body: uploadBody(release.manifest, release.files, metadata) }).pipe(
    Effect.mapError((error) => {
      const failure = fromCloudflare(error)
      return deployment.existing === null && failure.code === "no_permission"
        ? failed("cannot_create", failure.detail)
        : failure
    }),
  )
  yield* cf
    .call(`${script}/subdomain`, json({ enabled: true, previews_enabled: false }))
    .pipe(Effect.mapError(fromCloudflare))
})

const answersKiko = (fetch: FetchLike, url: string) =>
  fetch(`${url}/api/version`)
    .then(
      async (response) => response.ok && typeof ((await response.json()) as { version?: unknown }).version === "string",
    )
    .catch(() => false)

const seenEverywhere = (fetch: FetchLike, host: string) =>
  Promise.all(
    RESOLVERS.map((resolver) =>
      fetch(`${resolver}?name=${host}&type=A`, { headers: { accept: "application/dns-json" } })
        .then(async (response) => {
          const body = (await response.json()) as { Status?: number; Answer?: unknown[] }
          return body.Status === 0 && (body.Answer?.length ?? 0) > 0
        })
        .catch(() => false),
    ),
  ).then((seen) => seen.every(Boolean))

const goLive = Effect.fn("Installer.goLive")(function* (backendUrl: string, freshAddress: boolean) {
  const { fetch } = yield* Http
  yield* Effect.promise(() => answersKiko(fetch, backendUrl)).pipe(
    Effect.filterOrFail(Boolean, () => failed("not_ready")),
    Effect.retry({ schedule: POLL, times: 20 }),
  )
  if (freshAddress)
    yield* Effect.promise(() => seenEverywhere(fetch, new URL(backendUrl).host)).pipe(
      Effect.repeat({ schedule: POLL, until: Boolean, times: 30 }),
    )
})

const releasePrevious = Effect.fn("Installer.releasePrevious")(function* (ownerId: string, here: Pointer) {
  const clerk = yield* Clerk
  const previous = yield* clerk.user(ownerId)
  const pointsHere = previous?.pointer
    ? previous.pointer.accountId === here.accountId && previous.pointer.script === here.script
    : previous?.url === here.url
  if (pointsHere) yield* clerk.point(ownerId, null)
})

const install = Effect.fn("Installer.install")(function* (request: InstallRequest) {
  const access = yield* authorize(request.grant)
  const { fetch } = yield* Http
  const clerk = yield* Clerk
  const cf = cloudflare({ token: access.token, fetch })
  const accounts = yield* accountsOf(cf, request.grant.kind)
  const pointer = (yield* clerk.user(request.sub))?.pointer ?? null
  const place = yield* placeOf(cf, accounts, request, pointer)
  if (place._tag === "ChooseAccount") return place
  const release = yield* loadRelease()
  const deployment = yield* deploymentFor(place, request, pointer, release)
  if (deployment._tag === "Decide") return deployment
  const { subdomain, made } = yield* ensureSubdomain(cf, place.account.id)
  yield* upload(cf, place.account, deployment, access, release, request.sub)
  const backendUrl = `https://${deployment.name}.${subdomain}.workers.dev`
  yield* goLive(backendUrl, made)
  const here: Pointer = { v: 1, url: backendUrl, accountId: place.account.id, script: deployment.name }
  yield* clerk.point(request.sub, here)
  if (deployment.previousOwner) yield* releasePrevious(deployment.previousOwner, here)
  if (access.code) yield* (yield* CodeCache).forget(access.code)
  return { _tag: "Installed", backendUrl, version: release.manifest.version } satisfies InstallAnswer
})

const detach = Effect.fn("Installer.detach")(function* (sub: string) {
  yield* (yield* Clerk).point(sub, null)
})

export const makeInstaller = Effect.gen(function* () {
  const lock = yield* Semaphore.make(1)
  return {
    install: (request: InstallRequest) => lock.withPermits(1)(install(request)),
    detach: (sub: string) => lock.withPermits(1)(detach(sub)),
  }
})
