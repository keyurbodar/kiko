import { write } from "../lib/api-base"

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

export interface OAuthConfig {
  clientId: string
  authorizeUrl: string
  scopes: string[]
}

export interface TokenLink {
  url: string
  permissions: string[]
}

export type Grant = { kind: "oauth"; code: string; verifier: string; redirectUri: string } | { kind: "token"; token: string }

export interface InstallError {
  code: string
  message: string

  detail?: string

  accounts?: { id: string; name: string }[]

  installed?: boolean
}

export const INSTALLER_URL: string = (import.meta.env.VITE_INSTALLER_URL ?? "").replace(/\/+$/, "")

export const redirectUri = (origin: string) => `${origin}/connect/callback`

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

const randomString = () => b64url(crypto.getRandomValues(new Uint8Array(32)))

export async function challengeOf(verifier: string): Promise<string> {
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

export function oauthGrant(search: string, pending: { verifier: string; state: string } | null, uri: string): { grant: Grant } | { error: InstallError } {
  const params = new URLSearchParams(search)
  const denied = params.get("error")
  if (denied) return { error: { code: "oauth_denied", message: params.get("error_description") ?? "Cloudflare did not approve the connection." } }
  const code = params.get("code")
  if (!pending || !code || params.get("state") !== pending.state) {
    return { error: { code: "state_mismatch", message: "This sign-in link is not valid anymore." } }
  }
  return { grant: { kind: "oauth", code, verifier: pending.verifier, redirectUri: uri } }
}

export const STEPS = ["Checking your account", "Creating storage", "Uploading Kiko", "Starting it up"] as const

export interface Failure {
  message: string
  detail?: string
  link?: { href: string; label: string }
}

const WORKERS_DASHBOARD = "https://dash.cloudflare.com/?to=/:account/workers-and-pages"
const WORKERS_LINK = { href: WORKERS_DASHBOARD, label: "Open Workers in Cloudflare" }
const TOKENS_LINK = { href: "https://dash.cloudflare.com/profile/api-tokens", label: "Open API tokens in Cloudflare" }

export function retryKind(error: InstallError, grant: Grant["kind"] = "oauth"): "sign-in" | "new-grant" | "token" | "same" {
  if (error.installed) return "sign-in"
  if (grant === "token") return error.code === "bad_token" ? "token" : "same"
  return "new-grant"
}

export function tokenProblem(token: string): string | null {
  if (/^[0-9a-f]{37}$/i.test(token)) return "That looks like your Global API Key. Kiko needs an API token: create one with the link above and paste the value Cloudflare shows."
  if (/^[0-9a-f]{32}$/i.test(token)) return "That looks like a token's ID. Paste the token value Cloudflare showed once when you created it. If you no longer have it, roll the token or create a new one."
  return null
}

export function failureOf(error: InstallError): Failure {
  const base = sentence(error)
  return error.detail && !base.detail ? { ...base, detail: error.detail } : base
}

function sentence(error: InstallError): Failure {
  switch (error.code) {
    case "bad_token":
      return { message: "Cloudflare does not recognise this token. It may have been deleted, rolled, or copied in part. Paste the token value Cloudflare showed once when you created it.", link: TOKENS_LINK }
    case "cannot_create":
      return { message: "This token may change Workers but not create one. Edit the token, give it Workers Admin (not Workers Editor), then try again.", link: TOKENS_LINK }
    case "oauth_failed":
      return { message: "Cloudflare did not finish the sign-in. Connect again." }
    case "oauth_denied":
      return { message: "The Cloudflare sign-in was cancelled. Connect again when you are ready." }
    case "state_mismatch":
      return { message: "This sign-in link expired or was opened in another tab. Connect again from here." }
    case "network":
      return { message: "Could not reach the Kiko installer. Check your connection, then try again." }
    case "unreachable":
      return { message: error.message }
    case "no_subdomain":
      return { message: "This account has no workers.dev address yet. Create one, then try again.", link: WORKERS_LINK }
    case "no_account":
      return { message: "No Cloudflare account was found for this sign-in. Create one, then try again.", link: { href: "https://dash.cloudflare.com/sign-up", label: "Create a Cloudflare account" } }
    case "no_permission":
      return { message: "Cloudflare did not let this sign-in do a step of the install. Check that you are an admin of the account, or use an API token with the permissions Kiko lists under Use an API token instead.", link: TOKENS_LINK }
    case "busy":
      return { message: "Cloudflare is busy. Wait a minute, then try again." }
    case "cloudflare_down":
      return { message: "Cloudflare is having trouble right now. Try again in a few minutes.", link: { href: "https://www.cloudflarestatus.com/", label: "Open Cloudflare status" } }
    case "not_ready":
      return { message: "Kiko is installed but has not started answering yet. Wait a minute, then try again.", link: WORKERS_LINK }
    case "cloudflare_error":
      return { message: "Cloudflare did not accept a step of the install. Try again. If it keeps failing, open Workers in your dashboard once.", link: WORKERS_LINK }
    case "unauthorized":
      return { message: "Your Kiko sign-in expired. Reload the page and sign in again." }
    default:
      return { message: error.message }
  }
}

async function errorOf(res: Response): Promise<InstallError> {
  const body = (await res.json().catch(() => null)) as { error?: Partial<InstallError> } | null
  const e = body?.error
  return {
    code: e?.code ?? "failed",
    message: e?.message ?? `The install did not finish (the installer answered ${res.status}). Try again.`,
    ...(typeof e?.detail === "string" ? { detail: e.detail } : {}),
    ...(Array.isArray(e?.accounts) ? { accounts: e.accounts } : {}),
  }
}

async function installerGet<T>(path: string, valid: (body: Record<string, unknown>) => boolean, f: Fetch): Promise<T> {
  const res = await f(`${INSTALLER_URL}${path}`).catch(() => null)
  const body = res?.ok ? ((await res.json().catch(() => null)) as Record<string, unknown> | null) : null
  if (!body || typeof body !== "object" || !valid(body)) throw new Error("Could not reach the installer. Try again.")
  return body as T
}

export const loadOAuthConfig = (f: Fetch = fetch) =>
  installerGet<OAuthConfig>("/oauth/config", (b) => typeof b.clientId === "string" && typeof b.authorizeUrl === "string" && Array.isArray(b.scopes), f)

export const loadTokenLink = (f: Fetch = fetch) => installerGet<TokenLink>("/token-link", (b) => typeof b.url === "string" && Array.isArray(b.permissions), f)

export type InstallResult = { ok: true; backendUrl: string } | { ok: false; error: InstallError }

export async function install(clerkToken: string, grant: Grant, f: Fetch = fetch, accountId?: string, reset?: "delete-existing-data"): Promise<InstallResult> {
  let res: Response
  try {
    res = await f(`${INSTALLER_URL}/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clerkToken, grant, ...(accountId ? { accountId } : {}), ...(reset ? { reset } : {}) }),
    })
  } catch {
    return { ok: false, error: { code: "network", message: "Could not reach the installer. Check your connection." } }
  }
  if (!res.ok) return { ok: false, error: await errorOf(res) }
  const body = (await res.json().catch(() => null)) as { backendUrl?: unknown } | null
  if (typeof body?.backendUrl !== "string") return { ok: false, error: { code: "failed", message: "The install did not return an address." } }
  return { ok: true, backendUrl: body.backendUrl }
}

export async function connect(
  clerkToken: string,
  grant: Grant,
  exchange: () => Promise<void>,
  f: Fetch = fetch,
  accountId?: string,
  reset?: "delete-existing-data",
): Promise<InstallError | null> {
  const result = await install(clerkToken, grant, f, accountId, reset)
  if (!result.ok) return result.error
  write("kiko:backend", result.backendUrl)
  return finish(exchange)
}

export async function finish(exchange: () => Promise<void>): Promise<InstallError | null> {
  try {
    await exchange()
    return null
  } catch (e) {
    return { code: "unreachable", message: e instanceof Error ? e.message : "Could not sign in to your new backend. Try again.", installed: true }
  }
}

