import type { UpdateErrorCode } from "@kiko/protocol"
import * as Schema from "effect/Schema"

export const ClerkUserId = Schema.String.pipe(Schema.brand("ClerkUserId"))
export type ClerkUserId = typeof ClerkUserId.Type

export const BackendUrl = Schema.String.pipe(Schema.brand("BackendUrl"))
export type BackendUrl = typeof BackendUrl.Type

export const BackendKey = Schema.String.pipe(Schema.brand("BackendKey"))
export type BackendKey = typeof BackendKey.Type

export const SessionToken = Schema.String.pipe(Schema.brand("SessionToken"))
export type SessionToken = typeof SessionToken.Type

export interface Identity {
  readonly clerkUserId: ClerkUserId | null
  readonly email: string
}

export interface Backend {
  readonly url: BackendUrl
  readonly key: BackendKey
}

export interface BackendUser {
  readonly id: string
  readonly name: string
}

export type Descriptor =
  | { readonly _tag: "Current"; readonly version: string; readonly protocol: number; readonly selfUpdate: boolean }
  | { readonly _tag: "Legacy"; readonly version: string | null }
  | { readonly _tag: "Gone" }
  | { readonly _tag: "Unreachable" }

export type NeedsBackendReason = "none" | "gone" | "not_owner" | "legacy" | "detached"

export type InstallErrorCode =
  | "bad_request"
  | "unauthorized"
  | "clerk_expired"
  | "grant_invalid"
  | "bad_token"
  | "no_permission"
  | "cannot_create"
  | "no_account"
  | "no_subdomain"
  | "name_taken"
  | "not_keepable"
  | "busy"
  | "cloudflare_down"
  | "cloudflare_error"
  | "storage_full"
  | "release_unavailable"
  | "release_untrusted"
  | "not_ready"
  | "internal"
  | "network"
  | "oauth_denied"
  | "oauth_failed"
  | "state_mismatch"

export type InstallRetry = "same" | "new-grant" | "token"

export interface CloudflareAccount {
  readonly id: string
  readonly name: string
}

export interface Found {
  readonly script: string
  readonly owner: { readonly _tag: "Other"; readonly hint: string } | { readonly _tag: "Unknown" }
  readonly keepable: boolean
}

export type InstallPhase =
  | { readonly _tag: "Authorizing" }
  | { readonly _tag: "Running"; readonly step: "scan" | "upload" | "enable" | "dns" | "ready" }
  | { readonly _tag: "ChooseAccount"; readonly accounts: ReadonlyArray<CloudflareAccount> }
  | { readonly _tag: "Decide"; readonly found: Found }
  | {
      readonly _tag: "Failed"
      readonly code: InstallErrorCode
      readonly message: string
      readonly retry: InstallRetry
    }

export type UpdatePhase =
  | { readonly _tag: "Current" }
  | {
      readonly _tag: "Updating"
      readonly to: string
      readonly stage: "uploading" | "restarting"
      readonly compatible: boolean
    }
  | { readonly _tag: "Failed"; readonly to: string; readonly error: UpdateErrorCode }
  | { readonly _tag: "NeedsReconnect"; readonly reason: "no_grant" | "grant_refused" | "legacy" }

export type ClerkState = { readonly _tag: "None" } | { readonly _tag: "Live"; readonly email: string }

export type Phase =
  | { readonly _tag: "Booting" }
  | { readonly _tag: "SignedOut"; readonly clerk: ClerkState }
  | { readonly _tag: "Resolving"; readonly identity: Identity }
  | {
      readonly _tag: "NeedsBackend"
      readonly identity: Identity
      readonly reason: NeedsBackendReason
      readonly previous: Backend | null
    }
  | { readonly _tag: "Installing"; readonly identity: Identity; readonly install: InstallPhase }
  | { readonly _tag: "Unreachable"; readonly identity: Identity; readonly backend: Backend; readonly since: number }
  | {
      readonly _tag: "Ready"
      readonly identity: Identity
      readonly backend: Backend
      readonly user: BackendUser
      readonly token: SessionToken
      readonly update: UpdatePhase
    }
  | { readonly _tag: "SigningOut" }
