import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

export type Grant =
  | { readonly kind: "oauth"; readonly code: string; readonly verifier: string; readonly redirectUri: string }
  | { readonly kind: "token"; readonly token: string }

export type Decision = "take_over" | "start_fresh"

export type InstallRequest = {
  readonly clerkToken: string
  readonly grant: Grant
  readonly accountId?: string
  readonly decision?: Decision
}

const INSTALL_ERROR_CODES = [
  "bad_request",
  "unauthorized",
  "clerk_expired",
  "grant_invalid",
  "bad_token",
  "no_permission",
  "cannot_create",
  "no_account",
  "no_subdomain",
  "name_taken",
  "not_keepable",
  "busy",
  "cloudflare_down",
  "cloudflare_error",
  "storage_full",
  "release_unavailable",
  "release_untrusted",
  "missing_migration_tag",
  "not_ready",
  "internal",
] as const

const InstallErrorCode = Schema.Literals(INSTALL_ERROR_CODES)
export type InstallErrorCode = typeof InstallErrorCode.Type

const FailureCode = Schema.Literals([...INSTALL_ERROR_CODES, "network", "unreadable", "unknown"])

const Retry = Schema.Literals(["same", "new-grant", "token"])
export type Retry = typeof Retry.Type

const Account = Schema.Struct({ id: Schema.String, name: Schema.String })
export type Account = typeof Account.Type

const Found = Schema.Struct({
  script: Schema.String,
  owner: Schema.Union([Schema.TaggedStruct("Other", { hint: Schema.String }), Schema.TaggedStruct("Unknown", {})]),
  keepable: Schema.Boolean,
})
export type Found = typeof Found.Type

const OAuthConfig = Schema.Struct({
  clientId: Schema.String,
  authorizeUrl: Schema.String,
  scopes: Schema.Array(Schema.String),
})
export type OAuthConfig = typeof OAuthConfig.Type

const TokenLink = Schema.Struct({ url: Schema.String, permissions: Schema.Array(Schema.String) })
export type TokenLink = typeof TokenLink.Type

const Installed = Schema.Struct({ backendUrl: Schema.String, version: Schema.String })

const Problem = Schema.Struct({
  error: Schema.Struct({
    code: Schema.String,
    message: Schema.optional(Schema.String),
    retry: Schema.optional(Retry),
    detail: Schema.optional(Schema.String),
    accounts: Schema.optional(Schema.Array(Account)),
    found: Schema.optional(Found),
  }),
})
type Problem = typeof Problem.Type

export type InstallAnswer =
  | { readonly _tag: "Installed"; readonly backendUrl: string; readonly version: string }
  | { readonly _tag: "ChooseAccount"; readonly accounts: ReadonlyArray<Account> }
  | { readonly _tag: "Decide"; readonly found: Found }

export class InstallerFailed extends Schema.TaggedError<InstallerFailed>()("InstallerFailed", {
  code: FailureCode,
  message: Schema.String,
  retry: Retry,
  detail: Schema.optional(Schema.String),
}) {}

export type InstallerClient = {
  readonly oauthConfig: Effect.Effect<OAuthConfig, InstallerFailed>
  readonly tokenLink: Effect.Effect<TokenLink, InstallerFailed>
  readonly install: (request: InstallRequest) => Effect.Effect<InstallAnswer, InstallerFailed>
  readonly detach: (request: { readonly clerkToken: string }) => Effect.Effect<void, InstallerFailed>
}

const unreachable = new InstallerFailed({
  code: "network",
  message: "The installer could not be reached.",
  retry: "same",
})
const unreadable = new InstallerFailed({
  code: "unreadable",
  message: "The installer's answer could not be read.",
  retry: "same",
})

const isInstallErrorCode = Schema.is(InstallErrorCode)
const decodeInstalled = Schema.decodeUnknownOption(Installed)
const decodeProblem = Schema.decodeUnknownOption(Problem)
const decodeOAuthConfig = Schema.decodeUnknownOption(OAuthConfig)
const decodeTokenLink = Schema.decodeUnknownOption(TokenLink)

const failureOf = (error: Problem["error"]): InstallerFailed =>
  new InstallerFailed({
    code: isInstallErrorCode(error.code) ? error.code : "unknown",
    message: error.message ?? "",
    retry: error.retry ?? "same",
    ...(error.detail ? { detail: error.detail } : {}),
  })

function answerOf(error: Problem["error"]): Effect.Effect<InstallAnswer, InstallerFailed> {
  if (error.code === "choose_account")
    return error.accounts
      ? Effect.succeed({ _tag: "ChooseAccount", accounts: error.accounts })
      : Effect.fail(unreadable)
  if (error.code === "decide")
    return error.found ? Effect.succeed({ _tag: "Decide", found: error.found }) : Effect.fail(unreadable)
  return Effect.fail(failureOf(error))
}

const problemOf = (body: unknown): Option.Option<Problem["error"]> =>
  Option.map(decodeProblem(body), (problem) => problem.error)

export function makeInstallerClient(options: { readonly baseUrl: string; readonly fetch: Fetch }): InstallerClient {
  const call = (path: string, init?: RequestInit) =>
    Effect.tryPromise({ try: () => options.fetch(`${options.baseUrl}${path}`, init), catch: () => unreachable }).pipe(
      Effect.flatMap((response) =>
        Effect.promise(async () => ({ ok: response.ok, body: (await response.json().catch(() => null)) as unknown })),
      ),
    )
  const post = (path: string, body: object) =>
    call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  const read = <A>(path: string, decode: (body: unknown) => Option.Option<A>) =>
    call(path).pipe(
      Effect.flatMap(({ ok, body }) =>
        Option.match(ok ? decode(body) : Option.none(), {
          onNone: () => Effect.fail(unreadable),
          onSome: (value) => Effect.succeed(value),
        }),
      ),
    )

  return {
    oauthConfig: read("/oauth/config", decodeOAuthConfig),
    tokenLink: read("/token-link", decodeTokenLink),
    install: (request) =>
      post("/install", {
        clerkToken: request.clerkToken,
        grant: request.grant,
        ...(request.accountId ? { accountId: request.accountId } : {}),
        ...(request.decision ? { decision: request.decision } : {}),
      }).pipe(
        Effect.flatMap(({ ok, body }): Effect.Effect<InstallAnswer, InstallerFailed> => {
          if (ok)
            return Option.match(decodeInstalled(body), {
              onNone: () => Effect.fail(unreadable),
              onSome: (installed) => Effect.succeed({ _tag: "Installed", ...installed }),
            })
          return Option.match(problemOf(body), { onNone: () => Effect.fail(unreadable), onSome: answerOf })
        }),
      ),
    detach: (request) =>
      post("/detach", { clerkToken: request.clerkToken }).pipe(
        Effect.flatMap(({ ok, body }) =>
          ok
            ? Effect.void
            : Effect.fail(Option.match(problemOf(body), { onNone: () => unreadable, onSome: failureOf })),
        ),
      ),
  }
}

const INSTALLER_URL: string = (import.meta.env.VITE_INSTALLER_URL ?? "").replace(/\/+$/, "")

export const installerClient = makeInstallerClient({
  baseUrl: INSTALLER_URL,
  fetch: (input, init) => globalThis.fetch(input, init),
})
