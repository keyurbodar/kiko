import type { SecretBinding } from "@kiko/durable/release-plan"

export type Grant = { kind: "oauth"; code: string; verifier: string; redirectUri: string } | { kind: "token"; token: string }

export type StoredGrant = {
  kind: Grant["kind"]
  accountId: string
  /** The script this grant may replace, so the backend can update itself without asking which one it is. */
  scriptName: string
  /** The OAuth client the refresh token belongs to. */
  clientId?: string
  accessToken?: string
  refreshToken?: string
  token?: string
}

export const DEFAULT_SCRIPT = "kiko"

type BoundInput = { ownerId: string; clerkJwtKey: string; trustedOrigins: string; releaseBase: string; grant: StoredGrant }

const secret = (name: string, text: string): SecretBinding => ({ type: "secret_text", name, text })

/**
 * What ties a backend to this front door. Set on every install, so a backend that was deployed by hand, or by an
 * older installer, can be adopted: it learns the owner, the Clerk key, the origin, and where updates come from.
 */
export function boundSecrets(input: BoundInput): SecretBinding[] {
  return [
    secret("OWNER_ID", input.ownerId),
    secret("CLERK_JWT_KEY", input.clerkJwtKey),
    secret("TRUSTED_ORIGINS", input.trustedOrigins),
    secret("RELEASE_BASE_URL", input.releaseBase),
    secret("CF_GRANT", JSON.stringify(input.grant)),
  ]
}

/** A new backend also gets its own keys. An existing one keeps them, or its sessions and stored credentials break. */
export function firstInstallSecrets(input: BoundInput & { random: () => string }): SecretBinding[] {
  return [secret("SESSION_SECRET", input.random()), secret("CREDENTIALS_KEK", input.random()), ...boundSecrets(input)]
}

export async function ownScriptName(sub: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sub))
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
  return `${DEFAULT_SCRIPT}-${hex.slice(0, 6)}`
}

export const TOKEN_PERMISSIONS = [
  "Account: Workers Scripts: Edit",
  "Account: Account Settings: Read",
  "Account: Workers R2 Storage: Edit",
] as const

export const OAUTH_SCOPES = ["workers-scripts.write", "account-settings.read", "workers-r2.write", "offline_access"] as const
