import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
  type Account,
  type Decision,
  type Found,
  type Grant,
  type InstallAnswer,
  type InstallErrorCode,
  type InstallerClient,
  installerClient,
  type InstallerFailed,
  type OAuthConfig,
} from "./installer-client"

export const redirectUri = (origin: string) => `${origin}/connect/callback`

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")

const randomString = () => b64url(crypto.getRandomValues(new Uint8Array(32)))

async function challengeOf(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))))
}

export async function makePkce(): Promise<{ verifier: string; challenge: string; state: string }> {
  const verifier = randomString()
  return { verifier, challenge: await challengeOf(verifier), state: randomString() }
}

export function authorizeUrl(config: OAuthConfig, pkce: { challenge: string; state: string }, uri: string): string {
  const url = new URL(config.authorizeUrl)
  url.searchParams.set("client_id", config.clientId)
  url.searchParams.set("redirect_uri", uri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("scope", config.scopes.join(" "))
  url.searchParams.set("code_challenge", pkce.challenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("state", pkce.state)
  return url.toString()
}

const PENDING_KEY = "kiko:connect"

export function savePending(pkce: { verifier: string; state: string }, reconnect: boolean): void {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier: pkce.verifier, state: pkce.state, reconnect }))
}

export function takePending(): { verifier: string; state: string; reconnect: boolean } | null {
  const raw = sessionStorage.getItem(PENDING_KEY)
  sessionStorage.removeItem(PENDING_KEY)
  try {
    const value = JSON.parse(raw ?? "null") as { verifier?: unknown; state?: unknown; reconnect?: unknown } | null
    return value && typeof value.verifier === "string" && typeof value.state === "string"
      ? { verifier: value.verifier, state: value.state, reconnect: value.reconnect === true }
      : null
  } catch {
    return null
  }
}

export class ConnectTrouble extends Schema.TaggedError<ConnectTrouble>()("ConnectTrouble", {
  code: Schema.Literals(["oauth_denied", "state_mismatch", "signed_out", "clerk_unreachable"]),
}) {}

export type Trouble = InstallerFailed | ConnectTrouble

export function oauthGrant(
  search: string,
  pending: { verifier: string; state: string } | null,
  uri: string,
): { grant: Grant } | { trouble: ConnectTrouble } {
  const params = new URLSearchParams(search)
  if (params.get("error")) return { trouble: new ConnectTrouble({ code: "oauth_denied" }) }
  const code = params.get("code")
  if (!pending || !code || params.get("state") !== pending.state)
    return { trouble: new ConnectTrouble({ code: "state_mismatch" }) }
  return { grant: { kind: "oauth", code, verifier: pending.verifier, redirectUri: uri } }
}

export const STEPS = ["Checking your account", "Creating storage", "Uploading Kiko", "Starting it up"] as const

export type Attempt = {
  readonly grant: Grant
  readonly accountId?: string
  readonly decision?: Decision
  readonly accounts?: ReadonlyArray<Account>
  readonly found?: Found
}

export type Fix =
  | { readonly _tag: "Resend"; readonly attempt: Attempt }
  | { readonly _tag: "Reconnect" }
  | { readonly _tag: "SignInAgain" }
  | { readonly _tag: "FinishSignIn" }

type Link = { readonly href: string; readonly label: string }

export type Failure = {
  readonly sentence: string
  readonly detail?: string
  readonly link?: Link
  readonly fix: Fix
}

export type View =
  | { readonly _tag: "Start"; readonly paste: { readonly note: string; readonly keep: boolean } | null }
  | { readonly _tag: "Working" }
  | { readonly _tag: "ChooseAccount"; readonly attempt: Attempt; readonly accounts: ReadonlyArray<Account> }
  | { readonly _tag: "Decide"; readonly attempt: Attempt; readonly found: Found; readonly note: string | null }
  | { readonly _tag: "ConfirmFresh"; readonly attempt: Attempt; readonly found: Found }
  | { readonly _tag: "Failed"; readonly failure: Failure }

export const FIX_LABEL: Record<Fix["_tag"], string> = {
  Resend: "Try again",
  Reconnect: "Connect Cloudflare again",
  SignInAgain: "Sign in again",
  FinishSignIn: "Try again",
}

const WORKERS_LINK: Link = {
  href: "https://dash.cloudflare.com/?to=/:account/workers-and-pages",
  label: "Open Workers in Cloudflare",
}
type Copy = { readonly sentence: string; readonly link?: Link }

const NOT_ACCEPTED: Copy = {
  sentence: "Cloudflare did not accept this sign-in, or it has expired. Connect Cloudflare again.",
}

const COPY: Record<InstallErrorCode | "network" | "unreadable" | ConnectTrouble["code"], Copy> = {
  bad_request: { sentence: "The installer could not read this page's request. Try again." },
  unauthorized: { sentence: "The installer could not confirm your Kiko sign-in. Try again." },
  clerk_expired: { sentence: "Your Kiko sign-in expired before the installer could check it. Try again." },
  grant_invalid: NOT_ACCEPTED,
  bad_token: NOT_ACCEPTED,
  no_permission: {
    sentence:
      "Cloudflare did not let this sign-in do a step of the install. Connect Cloudflare again as an admin of the account.",
  },
  cannot_create: {
    sentence:
      "Cloudflare let this sign-in change Workers but not create one. Connect Cloudflare again as an admin of the account.",
  },
  no_account: {
    sentence: "No Cloudflare account was found for this sign-in. Create one, then try again.",
    link: { href: "https://dash.cloudflare.com/sign-up", label: "Create a Cloudflare account" },
  },
  no_subdomain: {
    sentence: "This Cloudflare account has no workers.dev address yet. Open Workers once to create it, then try again.",
    link: WORKERS_LINK,
  },
  name_taken: {
    sentence:
      "This Cloudflare account already has a Worker named kiko that is not Kiko. Rename or delete it in Cloudflare, then try again.",
    link: WORKERS_LINK,
  },
  not_keepable: {
    sentence: "This backend runs a Kiko version too old to update in place. Delete it in Cloudflare, then try again.",
    link: WORKERS_LINK,
  },
  busy: { sentence: "Cloudflare is busy. Wait a minute, then try again." },
  cloudflare_down: {
    sentence: "Cloudflare is having trouble right now. Try again in a few minutes.",
    link: { href: "https://www.cloudflarestatus.com/", label: "Open Cloudflare status" },
  },
  cloudflare_error: {
    sentence:
      "Cloudflare did not accept a step of the install. Try again. If it keeps failing, open Workers in Cloudflare once.",
    link: WORKERS_LINK,
  },
  storage_full: {
    sentence:
      "This Cloudflare account has used today's free Durable Object allowance. It resets at 00:00 UTC, so try again after that, or move to a paid Workers plan.",
  },
  release_unavailable: { sentence: "The Kiko release could not be loaded. Try again in a minute." },
  release_untrusted: {
    sentence: "The Kiko release did not pass its signature check, so nothing was installed. Try again later.",
  },
  not_ready: { sentence: "Kiko is installed but has not started answering yet. Wait a minute, then try again." },
  internal: { sentence: "The install did not finish. Try again." },
  network: { sentence: "Could not reach the Kiko installer. Check your connection, then try again." },
  unreadable: { sentence: "The Kiko installer did not answer as expected. Try again." },
  oauth_denied: { sentence: "The Cloudflare sign-in was cancelled. Connect again when you are ready." },
  state_mismatch: {
    sentence: "This Cloudflare sign-in expired or was opened in another tab. Connect again from here.",
  },
  signed_out: { sentence: "Your Kiko sign-in ended. Sign in again to finish connecting." },
  clerk_unreachable: {
    sentence: "Could not reach Kiko's sign-in service. Check your connection, then try again.",
  },
}

const PASTED_TOKEN: Partial<Record<Trouble["code"], Copy>> = {
  grant_invalid: {
    sentence: "Cloudflare did not accept this token. Paste the token value Cloudflare showed once when you created it.",
  },
  bad_token: {
    sentence:
      "Cloudflare does not recognise this token. It may have been deleted, rolled, or copied in part. Paste the token value Cloudflare showed once when you created it.",
  },
  no_permission: {
    sentence:
      "Cloudflare did not let this token do a step of the install. Give it every permission listed here, then install again.",
  },
  cannot_create: {
    sentence:
      "This token can change Workers but not create one. Edit it to have Workers Admin, not Workers Editor, then install again.",
  },
}

const KEEP_TOKEN: ReadonlySet<Trouble["code"]> = new Set(["no_permission", "cannot_create"])

const CLOUDFLARE_SAID: ReadonlySet<Trouble["code"]> = new Set([
  "bad_token",
  "no_permission",
  "cannot_create",
  "busy",
  "cloudflare_down",
  "cloudflare_error",
  "storage_full",
])

const NOT_KEEPABLE_NOTE = "It runs a Kiko version too old to keep its chats."

function copyOf(trouble: Trouble, grant: Grant["kind"]): Copy {
  const code = trouble.code
  if (code === "unknown") return { sentence: trouble.message.trim() || COPY.internal.sentence }
  return (grant === "token" ? PASTED_TOKEN[code] : undefined) ?? COPY[code]
}

export const sentenceOf = (trouble: Trouble, grant: Grant["kind"] = "oauth"): string => copyOf(trouble, grant).sentence

function fixOf(trouble: Trouble, attempt: Attempt | null): Fix | "paste" {
  if (trouble._tag === "ConnectTrouble") {
    if (trouble.code === "signed_out") return { _tag: "SignInAgain" }
    if (trouble.code === "clerk_unreachable" && attempt) return { _tag: "Resend", attempt }
    return { _tag: "Reconnect" }
  }
  if (trouble.retry === "same" && attempt) return { _tag: "Resend", attempt }
  return attempt?.grant.kind === "token" ? "paste" : { _tag: "Reconnect" }
}

const withoutDecision = ({ grant, accountId, accounts }: Attempt): Attempt => ({
  grant,
  ...(accountId ? { accountId } : {}),
  ...(accounts ? { accounts } : {}),
})

export function viewOfTrouble(trouble: Trouble, attempt: Attempt | null): View {
  if (trouble.code === "not_keepable" && attempt?.found)
    return {
      _tag: "Decide",
      attempt: withoutDecision(attempt),
      found: { ...attempt.found, keepable: false },
      note: NOT_KEEPABLE_NOTE,
    }
  const copy = copyOf(trouble, attempt?.grant.kind ?? "oauth")
  const fix = fixOf(trouble, attempt)
  if (fix === "paste") return { _tag: "Start", paste: { note: copy.sentence, keep: KEEP_TOKEN.has(trouble.code) } }
  const detail = trouble._tag === "InstallerFailed" && CLOUDFLARE_SAID.has(trouble.code) ? trouble.detail : undefined
  return { _tag: "Failed", failure: { ...copy, ...(detail ? { detail } : {}), fix } }
}

export function viewOfAnswer(answer: Exclude<InstallAnswer, { _tag: "Installed" }>, attempt: Attempt): View {
  if (answer._tag === "Decide") return { _tag: "Decide", attempt, found: answer.found, note: null }
  if (answer.accounts.length === 0)
    return { _tag: "Failed", failure: { ...COPY.no_account, fix: { _tag: "Resend", attempt } } }
  return { _tag: "ChooseAccount", attempt, accounts: answer.accounts }
}

export const pickAccount = (view: Extract<View, { _tag: "ChooseAccount" }>, accountId: string): Attempt => ({
  grant: view.attempt.grant,
  accountId,
  accounts: view.accounts,
})

type Deciding = Extract<View, { _tag: "Decide" | "ConfirmFresh" }>

export const takeOver = (view: Deciding): Attempt => ({ ...view.attempt, found: view.found, decision: "take_over" })

export const startFresh = (view: Deciding): Attempt => ({ ...view.attempt, found: view.found, decision: "start_fresh" })

export function anotherAccount(view: Extract<View, { _tag: "Decide" }>): View | null {
  const { grant, accounts } = view.attempt
  if (accounts && accounts.length > 1) return { _tag: "ChooseAccount", attempt: { grant }, accounts }
  if (grant.kind === "token")
    return { _tag: "Start", paste: { note: "Paste a token from the other Cloudflare account.", keep: false } }
  return null
}

export function signInFailed(error: unknown): View {
  const sentence =
    error instanceof Error && error.message.trim()
      ? error.message
      : "Kiko is installed, but signing in to it did not finish. Try again."
  return { _tag: "Failed", failure: { sentence, fix: { _tag: "FinishSignIn" } } }
}

function decideLede(found: Found): string {
  const where =
    found.owner._tag === "Other"
      ? `Its backend, ${found.script}, belongs to ${found.owner.hint}.`
      : `Its backend, ${found.script}, is from an earlier install.`
  if (!found.keepable) return `${where} ${NOT_KEEPABLE_NOTE}`
  return found.owner._tag === "Other"
    ? `${where} Keeping its chats moves it to this sign-in and signs ${found.owner.hint} out of it.`
    : `${where} If it is yours, keep its chats.`
}

export function headingOf(view: View, reconnect: boolean): { readonly title: string; readonly lede: string } {
  switch (view._tag) {
    case "Working":
      return { title: "Installing Kiko", lede: "This takes up to a minute." }
    case "Decide":
      return { title: "This account already has Kiko", lede: decideLede(view.found) }
    case "ConfirmFresh":
      return {
        title: "Start fresh?",
        lede: `This deletes ${view.found.script} and everything in it, including its chats. It cannot be undone.`,
      }
    default:
      return reconnect
        ? {
            title: "Reconnect Cloudflare",
            lede: "Your Cloudflare connection has ended. Connect it again so Kiko keeps running in your account.",
          }
        : {
            title: "Put Kiko on your Cloudflare",
            lede: "Kiko runs in your own Cloudflare account. Your chats and keys stay there.",
          }
  }
}

export function tokenProblem(token: string): string | null {
  if (/^[0-9a-f]{37}$/i.test(token))
    return "That looks like your Global API Key. Kiko needs an API token: create one with the link above and paste the value Cloudflare shows."
  if (/^[0-9a-f]{32}$/i.test(token))
    return "That looks like a token's ID. Paste the token value Cloudflare showed once when you created it. If you no longer have it, roll the token or create a new one."
  return null
}

export type Ports = {
  readonly client: InstallerClient
  readonly clerkToken: () => Promise<string | null>
}

const clerkTokenOf = (ports: Ports): Effect.Effect<string, ConnectTrouble> =>
  Effect.tryPromise({
    try: ports.clerkToken,
    catch: () => new ConnectTrouble({ code: "clerk_unreachable" }),
  }).pipe(
    Effect.flatMap((token) =>
      token ? Effect.succeed(token) : Effect.fail(new ConnectTrouble({ code: "signed_out" })),
    ),
  )

export const sendAttempt = (attempt: Attempt, ports: Ports): Effect.Effect<InstallAnswer, Trouble> =>
  clerkTokenOf(ports).pipe(
    Effect.flatMap((clerkToken) =>
      ports.client.install({
        clerkToken,
        grant: attempt.grant,
        ...(attempt.accountId ? { accountId: attempt.accountId } : {}),
        ...(attempt.decision ? { decision: attempt.decision } : {}),
      }),
    ),
  )

export const detachBackend = (ports: Ports): Effect.Effect<void, Trouble> =>
  clerkTokenOf(ports).pipe(Effect.flatMap((clerkToken) => ports.client.detach({ clerkToken })))

export function detachSentence(trouble: Trouble): string {
  switch (trouble.code) {
    case "network":
    case "clerk_unreachable":
    case "unauthorized":
      return COPY[trouble.code].sentence
    case "clerk_expired":
      return COPY.unauthorized.sentence
    case "signed_out":
      return "Your Kiko sign-in ended. Sign out and sign in again, then disconnect."
    default:
      return "Kiko could not disconnect the backend. Try again."
  }
}

const freshClerkToken = async (): Promise<string | null> => {
  const { loadClerk } = await import("./clerk")
  const clerk = await loadClerk()
  return (await clerk.session?.getToken({ skipCache: true })) ?? null
}

export const livePorts: Ports = { client: installerClient, clerkToken: freshClerkToken }
