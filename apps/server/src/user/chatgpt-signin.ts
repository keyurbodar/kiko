import type { LoginOptions, OAuthAuth, OAuthCredential, ProviderAuthInteraction } from "@earendil-works/pi-ai"

const DYNAMIC_CLIENT_ID = "dynamic_agent_client"
const AUTHORIZE_URL = "https://auth.openai.com/api/accounts/authorize"
const TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token"
const RESOURCE = "https://api.openai.com/v1"
const REDIRECT_URI = "http://127.0.0.1:1455/auth/callback"
const DIRECT_TOKEN_SCOPE = "chatgpt.tokens.use.direct"
const SCOPE = `openid profile email offline_access resource.invoke ${DIRECT_TOKEN_SCOPE}`
const EXPIRY_MARGIN_MS = 3 * 60 * 1000

const PASTE_MESSAGE =
  "After you approve, the browser shows a page that cannot load. Copy its full address and paste it here."

class SignInError extends Error {
  constructor(readonly code: "wrong_address" | "denied" | "exchange", message: string) {
    super(message)
  }
}

function base64url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

function randomValue(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)))
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomValue()
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(new Uint8Array(hash)) }
}

export function authorizeUrl(input: { hostId: string; state: string; nonce: string; challenge: string; agentName?: string }): string {
  const url = new URL(AUTHORIZE_URL)
  url.search = new URLSearchParams({
    client_id: DYNAMIC_CLIENT_ID,
    agent_name_hint: input.agentName ?? "Kiko",
    ext_agent_host_id: `urn:uuid:${input.hostId.toLowerCase()}`,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    resource: RESOURCE,
    scope: SCOPE,
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    nonce: input.nonce,
  }).toString()
  return url.toString()
}

function parseCallback(input: string, expectedState: string): { code: string; clientId: string } {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new SignInError("wrong_address", "The pasted text is not a web address")
  }
  const expected = new URL(REDIRECT_URI)
  if (url.origin !== expected.origin || url.pathname !== expected.pathname) {
    throw new SignInError("wrong_address", "The pasted address does not start with the sign-in address")
  }
  const denied = url.searchParams.get("error")
  if (denied) throw new SignInError("denied", `ChatGPT sign-in was refused: ${denied}`)
  const code = url.searchParams.get("code")
  if (!code) throw new SignInError("wrong_address", "The pasted address has no authorization code")
  const state = url.searchParams.get("state")
  if (!state || state !== expectedState) throw new SignInError("wrong_address", "The pasted address belongs to another sign-in")
  const clientId = url.searchParams.get("client_id")?.trim()
  if (!clientId) throw new SignInError("wrong_address", "The pasted address has no client id")
  return { code, clientId }
}

type TokenResponse = { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; id_token?: unknown; scope?: unknown }

async function requestToken(body: URLSearchParams, signal: AbortSignal): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body,
    signal,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new SignInError("exchange", `OpenAI token request failed (${response.status}): ${text || response.statusText}`)
  }
  const data: unknown = await response.json()
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new SignInError("exchange", "OpenAI token response must be an object")
  return data as TokenResponse
}

function field(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new SignInError("exchange", `OpenAI token response has invalid ${name}`)
  return value
}

function credentialFrom(token: TokenResponse, clientId: string): OAuthCredential {
  const access = field(token.access_token, "access_token")
  const refresh = field(token.refresh_token, "refresh_token")
  const scopes = field(token.scope, "scope").trim().split(/\s+/).filter(Boolean)
  if (typeof token.expires_in !== "number" || !Number.isFinite(token.expires_in) || token.expires_in <= 0) {
    throw new SignInError("exchange", "OpenAI token response has invalid expires_in")
  }
  if (!scopes.includes(DIRECT_TOKEN_SCOPE)) throw new SignInError("exchange", `OpenAI grant did not include ${DIRECT_TOKEN_SCOPE}`)
  return { type: "oauth", access, refresh, expires: Date.now() + token.expires_in * 1000 - EXPIRY_MARGIN_MS, clientId, scopes }
}

async function pasteLogin(interaction: ProviderAuthInteraction, options?: LoginOptions): Promise<OAuthCredential> {
  const hostId = options?.getDeviceId?.()
  if (!hostId) throw new Error("sign-in needs an installation id")
  const { verifier, challenge } = await pkce()
  const state = randomValue()
  const nonce = randomValue()
  interaction.notify({
    type: "auth_url",
    url: authorizeUrl({ hostId, state, nonce, challenge, ...(options?.agentName ? { agentName: options.agentName } : {}) }),
    instructions: "Approve Kiko in the browser tab that opens.",
  })
  const pasted = await interaction.prompt({ type: "manual_code", message: PASTE_MESSAGE, placeholder: REDIRECT_URI, signal: interaction.signal })
  const { code, clientId } = parseCallback(pasted, state)
  interaction.notify({ type: "progress", message: "Exchanging the authorization code for tokens..." })
  const token = await requestToken(
    new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: REDIRECT_URI, resource: RESOURCE }),
    interaction.signal,
  )
  field(token.id_token, "id_token")
  return credentialFrom(token, clientId)
}

export function withPasteLogin(oauth: OAuthAuth): OAuthAuth {
  return { ...oauth, login: pasteLogin }
}
