import type { ClerkTrust } from "@kiko/durable/clerk-token"
import type { UpdateConfig } from "../user/update"
import { devOverride } from "./dev-guard"

const PUBLIC_KEY = "9m0G9Ew6-gPLSZfItPOYlOsWO-HzvGRzElO9hdjWVhU"
const DEFAULT_BASE = "https://app.kiko.works/releases"
const FRONT_DOOR_ORIGIN = "https://app.kiko.works"
const CLERK_JWT_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzxhRgQne3bhFN05UAJ7m
6pTgab7RF9hub8ESxwJ3+5akcw3KHhhYXA9HZNVXNQokVQmrzHNRggIL2ZUIzcfA
cS+VZC7P1kJdWYhVcayqu7tUUfmhdzGf9VnZWuzN7FvRV8yfsqVzVwYiNLMMHsX5
WlDlScJeF6ERQj17jOpnFK8yn1TDBJur5vZuUnW1iNngpCXYGc4wCte1Kta4ud7z
NTbQuCY6GFIjPyU48ed6SzL6ULR9F/RHUr2PSL31f0TX0vEdWCJfNJa3Y7NEz8Jf
dPQdl2sXtrei6NBcrlnwqyTW5O2K8zPTBoYazGYjnd5hud+e+2wcVlgZrJD/zee9
ZQIDAQAB
-----END PUBLIC KEY-----`

export type ReleaseEnv = { CLERK_JWT_KEY?: string; TRUSTED_ORIGINS?: string; RELEASE_BASE_URL?: string }

export type ReleaseConfig = { readonly clerk: ClerkTrust; readonly releaseBase: string; readonly publicKey: string }

export function releaseConfig(env: ReleaseEnv): ReleaseConfig {
  const dev = devOverride(() => env)
  const origins = dev?.TRUSTED_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
  return {
    clerk: {
      key: dev?.CLERK_JWT_KEY ?? CLERK_JWT_KEY,
      trustedOrigins: origins?.length ? origins : [FRONT_DOOR_ORIGIN],
    },
    releaseBase: dev?.RELEASE_BASE_URL ?? DEFAULT_BASE,
    publicKey: PUBLIC_KEY,
  }
}

export function updateConfig(env: ReleaseEnv, dev: Partial<UpdateConfig> | null): UpdateConfig {
  return {
    releaseBase: dev?.releaseBase ?? releaseConfig(env).releaseBase,
    publicKey: dev?.publicKey ?? PUBLIC_KEY,
    cfApi: dev?.cfApi ?? "https://api.cloudflare.com/client/v4",
    oauthUrl: dev?.oauthUrl ?? "https://dash.cloudflare.com/oauth2/token",
  }
}
