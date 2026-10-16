import { write } from "../lib/api-base"

/*
 * The Connect Cloudflare flow (docs/app-kiko.md, "Joining: the install flow"). Pure steps with the network
 * passed in, so tests drive them with a fake fetch. The screen is connect.tsx.
 */

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
  /** What Cloudflare itself said, and the step. Shown small under the message. */
  detail?: string
  /** For `choose_account`: the accounts this sign-in can install into. */
  accounts?: { id: string; name: string }[]
  /** The install finished and only signing in to the new backend failed, so a retry signs in again. */
  installed?: boolean
}

export const INSTALLER_URL: string = (import.meta.env.VITE_INSTALLER_URL ?? "").replace(/\/+$/, "")

export const redirectUri = (origin: string) => `${origin}/connect/callback`

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

const randomString = () => b64url(crypto.getRandomValues(new Uint8Array(32)))

/** base64url(SHA-256(verifier)) without padding. */
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

/** The grant a Cloudflare redirect carries, or the reason it cannot be used. State is checked before anything is sent. */
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

/**
 * What "Try again" does after a failure. "sign-in": the backend is installed, only signing in to it failed.
 * "new-grant": the Cloudflare sign-in itself failed, so it starts over. "same": the same grant again; an OAuth
 * code can be sent twice because the installer keeps what it was traded for.
 */
export function retryKind(error: InstallError): "sign-in" | "new-grant" | "same" {
  if (error.installed) return "sign-in"
  return ["oauth_failed", "oauth_denied", "state_mismatch"].includes(error.code) ? "new-grant" : "same"
}

/** What to show for an installer error: a plain sentence and at most one link. "Try again" is always offered, and an install that stopped halfway picks up where it left off. */
export function failureOf(error: InstallError): Failure {
  const base = sentence(error)
  return error.detail && !base.detail ? { ...base, detail: error.detail } : base
}

function sentence(error: InstallError): Failure {
  switch (error.code) {
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
      return { message: "Cloudflare did not let this sign-in do a step of the install. Check that you are an admin of the account, or use an API token with the permissions listed below.", link: TOKENS_LINK }
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

export async function loadOAuthConfig(f: Fetch = fetch): Promise<OAuthConfig> {
  const res = await f(`${INSTALLER_URL}/oauth/config`)
  if (!res.ok) throw new Error("Could not reach the installer. Try again.")
  return (await res.json()) as OAuthConfig
}

export async function loadTokenLink(f: Fetch = fetch): Promise<TokenLink> {
  const res = await f(`${INSTALLER_URL}/token-link`)
  if (!res.ok) throw new Error("Could not reach the installer. Try again.")
  return (await res.json()) as TokenLink
}

export type InstallResult = { ok: true; backendUrl: string } | { ok: false; error: InstallError }

export async function install(clerkToken: string, grant: Grant, f: Fetch = fetch, accountId?: string): Promise<InstallResult> {
  let res: Response
  try {
    res = await f(`${INSTALLER_URL}/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clerkToken, grant, ...(accountId ? { accountId } : {}) }),
    })
  } catch {
    return { ok: false, error: { code: "network", message: "Could not reach the installer. Check your connection." } }
  }
  if (!res.ok) return { ok: false, error: await errorOf(res) }
  const body = (await res.json().catch(() => null)) as { backendUrl?: unknown } | null
  if (typeof body?.backendUrl !== "string") return { ok: false, error: { code: "failed", message: "The install did not return an address." } }
  return { ok: true, backendUrl: body.backendUrl }
}

/** Installs, then keeps the new address and signs in to it. The address is stored before the exchange runs. */
export async function connect(
  clerkToken: string,
  grant: Grant,
  exchange: () => Promise<void>,
  f: Fetch = fetch,
  accountId?: string,
): Promise<InstallError | null> {
  const result = await install(clerkToken, grant, f, accountId)
  if (!result.ok) return result.error
  write("kiko:backend", result.backendUrl)
  return finish(exchange)
}

/** Signs in to the installed backend. A failure keeps the install: "Try again" only signs in again. */
export async function finish(exchange: () => Promise<void>): Promise<InstallError | null> {
  try {
    await exchange()
    return null
  } catch (e) {
    return { code: "unreachable", message: e instanceof Error ? e.message : "Could not sign in to your new backend. Try again.", installed: true }
  }
}

