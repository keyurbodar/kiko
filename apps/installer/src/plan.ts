export type Grant =
  | { kind: "oauth"; code: string; verifier: string; redirectUri: string }
  | { kind: "token"; token: string }

export type StoredGrant = {
  kind: Grant["kind"]
  accountId: string
  scriptName: string
  clientId?: string
  accessToken?: string
  refreshToken?: string
  token?: string
}

export const TOKEN_PERMISSIONS = [
  "Account: Workers Admin (it may show as Workers Scripts: Edit)",
  "Account: Account Settings: Read",
  "Account: Workers R2 Storage: Edit (optional, for files)",
] as const

const TEMPLATE_KEYS = [
  { key: "workers_scripts", type: "edit" },
  { key: "account_settings", type: "read" },
  { key: "workers_r2", type: "edit" },
]

export const TOKEN_TEMPLATE_URL = `https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=${encodeURIComponent(JSON.stringify(TEMPLATE_KEYS))}&accountId=*&zoneId=all&name=Kiko`

export const OAUTH_SCOPES = [
  "workers-scripts.write",
  "account-settings.read",
  "workers-r2.write",
  "offline_access",
] as const
