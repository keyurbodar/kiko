import type { SecretBinding } from "@kiko/durable/release-plan"

export type Grant = { kind: "oauth"; code: string; verifier: string; redirectUri: string } | { kind: "token"; token: string }

export type StoredGrant = {
  kind: Grant["kind"]
  accountId: string
  accessToken?: string
  refreshToken?: string
  token?: string
}

export const DEFAULT_SCRIPT = "kiko"

export function firstInstallSecrets(input: {
  random: () => string
  ownerId: string
  clerkJwtKey: string
  trustedOrigins: string
  grant: StoredGrant
}): SecretBinding[] {
  const secret = (name: string, text: string): SecretBinding => ({ type: "secret_text", name, text })
  return [
    secret("SESSION_SECRET", input.random()),
    secret("CREDENTIALS_KEK", input.random()),
    secret("OWNER_ID", input.ownerId),
    secret("CLERK_JWT_KEY", input.clerkJwtKey),
    secret("TRUSTED_ORIGINS", input.trustedOrigins),
    secret("CF_GRANT", JSON.stringify(input.grant)),
  ]
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
