import * as Schema from "effect/Schema"
import { ReleaseVersion } from "./user"

export const PROTOCOL = 3

export const speaksRpc = (build: { readonly rpc?: unknown }): boolean => build.rpc === true

export const UpdateErrorCode = Schema.Literals([
  "no_grant",
  "grant_refused",
  "release_unavailable",
  "release_untrusted",
  "cloudflare_error",
])
export type UpdateErrorCode = typeof UpdateErrorCode.Type

export const UpdateState = Schema.Union([
  Schema.Struct({ stage: Schema.Literal("idle") }),
  Schema.Struct({ stage: Schema.Literals(["uploading", "restarting"]), to: ReleaseVersion }),
  Schema.Struct({
    stage: Schema.Literal("failed"),
    to: ReleaseVersion,
    error: UpdateErrorCode,
    message: Schema.String,
  }),
])
export type UpdateState = typeof UpdateState.Type
