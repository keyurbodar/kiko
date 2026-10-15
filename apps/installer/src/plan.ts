import type { ReleaseManifest, ReleaseMigration } from "@kiko/durable/release"

export type Grant = { kind: "oauth"; code: string; verifier: string; redirectUri: string } | { kind: "token"; token: string }

export type StoredGrant = {
  kind: Grant["kind"]
  accountId: string
  accessToken?: string
  refreshToken?: string
  token?: string
}

export type MigrationPlan = { old_tag?: string; new_tag: string; steps: ReleaseMigration[] }

export const BUCKET = "kiko-files"
export const DEFAULT_SCRIPT = "kiko"

const BINDINGS = [
  { type: "durable_object_namespace", name: "USER", class_name: "UserDO" },
  { type: "durable_object_namespace", name: "ROOM", class_name: "RoomDO" },
  { type: "durable_object_namespace", name: "AGENT", class_name: "AgentDO" },
  { type: "r2_bucket", name: "FILES", bucket_name: BUCKET },
] as const

// Which migration steps to send. A new script sends them all. An existing script sends the steps after the tag
// it already ran. A script at the latest tag sends none.
export function selectMigrations(all: ReleaseMigration[], currentTag: string | null): MigrationPlan {
  const last = all.at(-1)
  if (!last) throw new Error("The release has no migrations.")
  if (currentTag === null) return { new_tag: last.tag, steps: all }
  const at = all.findIndex((m) => m.tag === currentTag)
  if (at < 0) throw new Error(`The backend is at migration ${currentTag}, which this release does not know.`)
  return { old_tag: currentTag, new_tag: last.tag, steps: all.slice(at + 1) }
}

export type SecretBinding = { type: "secret_text"; name: string; text: string }

export function buildMetadata(manifest: ReleaseManifest, migrations: MigrationPlan, secrets: SecretBinding[] | null) {
  return {
    main_module: manifest.main_module,
    compatibility_date: manifest.compatibility_date,
    compatibility_flags: manifest.compatibility_flags,
    bindings: [...BINDINGS, ...(secrets ?? [])],
    migrations,
    ...(secrets ? {} : { keep_bindings: ["secret_text"] }),
  }
}

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
