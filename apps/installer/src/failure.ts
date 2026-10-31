import type { CloudflareError } from "@kiko/durable/cloudflare"
import * as Schema from "effect/Schema"

export const InstallErrorCode = Schema.Literals([
  "bad_request",
  "unauthorized",
  "clerk_expired",
  "grant_invalid",
  "bad_token",
  "no_permission",
  "cannot_create",
  "no_account",
  "no_subdomain",
  "name_taken",
  "not_keepable",
  "busy",
  "cloudflare_down",
  "cloudflare_error",
  "storage_full",
  "release_unavailable",
  "release_untrusted",
  "missing_migration_tag",
  "not_ready",
  "internal",
])
export type InstallErrorCode = typeof InstallErrorCode.Type

export type Retry = "same" | "new-grant" | "token"

export class InstallFailed extends Schema.TaggedError<InstallFailed>()("InstallFailed", {
  code: InstallErrorCode,
  message: Schema.String,
  detail: Schema.optional(Schema.String),
}) {}

const SAID: Record<InstallErrorCode, string> = {
  bad_request: "Send clerkToken and a grant.",
  unauthorized: "Sign in again.",
  clerk_expired: "Your Kiko sign-in expired. Try again.",
  grant_invalid: "Cloudflare did not accept the sign-in. Try connecting again.",
  bad_token:
    "Cloudflare does not recognise this token. Paste the token value Cloudflare showed once when you created it.",
  no_permission: "Cloudflare did not let this sign-in do a step of the install.",
  cannot_create:
    "This sign-in may change Workers but not create one. Give the token Workers Admin, not Workers Editor, then try again.",
  no_account: "No Cloudflare account was found for this sign-in.",
  no_subdomain: "Open Workers once in your Cloudflare dashboard to create your workers.dev address, then try again.",
  name_taken:
    "This Cloudflare account already has a Worker named kiko that is not Kiko. Rename or delete it, or use another Cloudflare account.",
  not_keepable: "This backend is too old to keep its chats. Start fresh, or use another Cloudflare account.",
  busy: "Cloudflare is busy. Wait a minute, then try again.",
  cloudflare_down: "Cloudflare is having trouble right now. Try again in a few minutes.",
  cloudflare_error: "Cloudflare did not accept a step of the install.",
  storage_full:
    "This Cloudflare account has used its free daily allowance of Durable Object storage, so the install could not save its step. The allowance resets at 00:00 UTC, and trying again after that works. A paid Workers plan removes the daily limit.",
  release_unavailable: "The Kiko release could not be loaded. Try again.",
  release_untrusted: "The Kiko release did not verify. Nothing was uploaded.",
  missing_migration_tag:
    "This backend is deployed, but Cloudflare reports no migration tag for it, so Kiko cannot tell which schema it runs. Delete it in Cloudflare, then install again.",
  not_ready: "The backend was installed but did not answer in time. Try again in a minute.",
  internal: "The install failed. Try again.",
}

const STATUS: Partial<Record<InstallErrorCode, number>> = {
  bad_request: 400,
  unauthorized: 401,
  clerk_expired: 401,
  grant_invalid: 400,
  bad_token: 400,
  no_permission: 403,
  cannot_create: 403,
  no_account: 400,
  no_subdomain: 409,
  name_taken: 409,
  not_keepable: 409,
  missing_migration_tag: 409,
  storage_full: 503,
  not_ready: 504,
  internal: 500,
}

const NEW_GRANT: ReadonlySet<InstallErrorCode> = new Set(["grant_invalid", "no_permission", "cannot_create"])

export const retryOf = (code: InstallErrorCode): Retry =>
  code === "bad_token" ? "token" : NEW_GRANT.has(code) ? "new-grant" : "same"

export const statusOf = (code: InstallErrorCode): number => STATUS[code] ?? 502

export const failed = (code: InstallErrorCode, detail?: string): InstallFailed =>
  new InstallFailed({ code, message: SAID[code], ...(detail ? { detail } : {}) })

const DENIED = new Set([10000, 9109])
const UNKNOWN_TOKEN = 6003

export const ROWS_FULL = /exceeded allowed rows (?:written|read) in durable objects/i

export function fromCloudflare(error: CloudflareError): InstallFailed {
  const detail = error.codes.length > 0 ? `${error.message} [${error.codes.join(", ")}]` : error.message
  if (error.status === 0) return failed("cloudflare_down", detail)
  if (error.codes.includes(UNKNOWN_TOKEN) || /invalid (access|api) token/i.test(error.said))
    return failed("bad_token", detail)
  if (ROWS_FULL.test(error.said)) return failed("storage_full", detail)
  if (error.status === 401 || error.status === 403 || error.codes.some((code) => DENIED.has(code)))
    return failed("no_permission", detail)
  if (error.status === 429) return failed("busy", detail)
  return failed(error.status >= 500 ? "cloudflare_down" : "cloudflare_error", detail)
}
