import type { UpdateConfig } from "../user/update"

// Baked into the bundle. A Worker var can move the release base, never the key, so a var cannot make the
// backend trust a release that the owner of this key did not sign.
const PUBLIC_KEY = "9m0G9Ew6-gPLSZfItPOYlOsWO-HzvGRzElO9hdjWVhU"
const DEFAULT_BASE = "https://app.kiko.works/releases"

type ReleaseEnv = { RELEASE_BASE_URL?: string }

export function updateConfig(env: ReleaseEnv, dev: Partial<UpdateConfig> | null): UpdateConfig {
  return {
    releaseBase: dev?.releaseBase ?? env.RELEASE_BASE_URL ?? DEFAULT_BASE,
    publicKey: PUBLIC_KEY,
    cfApi: dev?.cfApi ?? "https://api.cloudflare.com/client/v4",
    oauthUrl: dev?.oauthUrl ?? "https://dash.cloudflare.com/oauth2/token",
  }
}
