import { compatibility, type Descriptor } from "@kiko/client-runtime/connection"
import { PROTOCOL, type UpdateErrorCode, type UpdateState } from "@kiko/protocol"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { olderThan, type Skew } from "./version-skew"

export type UpdateFailure = UpdateErrorCode | "timeout" | "unreachable"

type ReconnectReason = "legacy" | "no_grant" | "grant_refused"

export type UpdatePhase =
  | { readonly _tag: "Current" }
  | {
      readonly _tag: "Updating"
      readonly to: string
      readonly stage: "uploading" | "restarting"
      readonly compatible: boolean
    }
  | { readonly _tag: "Failed"; readonly to: string; readonly error: UpdateFailure }
  | { readonly _tag: "NeedsReconnect"; readonly reason: ReconnectReason }

export const CURRENT: UpdatePhase = { _tag: "Current" }

export type Plan =
  | { readonly _tag: "Stay" }
  | { readonly _tag: "Reconnect"; readonly reason: "legacy" | "no_grant" }
  | { readonly _tag: "Start"; readonly to: string; readonly compatible: boolean }

const STAY: Plan = { _tag: "Stay" }

export function plan(descriptor: Descriptor, to: string): Plan {
  if (descriptor._tag === "Unreachable") return STAY
  if (descriptor._tag === "Legacy") return { _tag: "Reconnect", reason: "legacy" }
  const behind =
    descriptor.protocol < PROTOCOL || (descriptor.protocol === PROTOCOL && olderThan(descriptor.version, to))
  if (!behind) return STAY
  if (!descriptor.selfUpdate) return { _tag: "Reconnect", reason: "no_grant" }
  return { _tag: "Start", to, compatible: descriptor.protocol === PROTOCOL }
}

export interface UpdateBackend {
  readonly start: (to: string) => Effect.Effect<UpdateState | null>
  readonly state: Effect.Effect<UpdateState | null>
  readonly descriptor: Effect.Effect<Descriptor>
}

export const landed = (descriptor: Descriptor, to: string): boolean =>
  descriptor._tag === "Current" && !olderThan(descriptor.version, to)

const POLL_EVERY = "2 seconds"
const GIVE_UP_AFTER = "3 minutes"

function failed(to: string, error: UpdateFailure): UpdatePhase {
  return error === "no_grant" || error === "grant_refused"
    ? { _tag: "NeedsReconnect", reason: error }
    : { _tag: "Failed", to, error }
}

const watch = Effect.fn("Update.watch")(function* (backend: UpdateBackend, to: string, onRestart: Effect.Effect<void>) {
  for (;;) {
    yield* Effect.sleep(POLL_EVERY)
    const state = yield* backend.state
    if (state?.stage === "failed") return failed(to, state.error)
    if (state?.stage === "restarting") yield* onRestart
    if (landed(yield* backend.descriptor, to)) return CURRENT
  }
})

export const runUpdate = Effect.fn("Update.run")(function* (
  backend: UpdateBackend,
  to: string,
  onRestart: Effect.Effect<void>,
) {
  const started = yield* backend.start(to)
  if (started === null) return failed(to, "unreachable")
  if (started.stage === "failed") return failed(to, started.error)
  if (started.stage === "restarting") yield* onRestart
  return yield* watch(backend, to, onRestart).pipe(
    Effect.timeoutOption(GIVE_UP_AFTER),
    Effect.map(Option.getOrElse(() => failed(to, "timeout"))),
  )
})

export type Hold = "backend-behind" | "app-behind"

export function holdOf(input: {
  readonly connected: boolean
  readonly blocked: Hold | null
  readonly descriptor: Descriptor | undefined
}): Hold | null {
  if (input.connected) return null
  if (input.blocked) return input.blocked
  const fit = input.descriptor ? compatibility(input.descriptor) : "unknown"
  return fit === "backend-behind" || fit === "app-behind" ? fit : null
}

export type Notice =
  | { readonly kind: "checking" }
  | { readonly kind: "updating" }
  | { readonly kind: "reconnect"; readonly reason: ReconnectReason }
  | { readonly kind: "retry" }
  | { readonly kind: "reload" }

export function noticeOf(hold: Hold | null, phase: UpdatePhase): Notice | null {
  if (hold === null) return null
  if (hold === "app-behind") return { kind: "reload" }
  switch (phase._tag) {
    case "Current":
      return { kind: "checking" }
    case "Updating":
      return { kind: "updating" }
    case "NeedsReconnect":
      return { kind: "reconnect", reason: phase.reason }
    case "Failed":
      return { kind: "retry" }
  }
}

export type PillView =
  | { readonly kind: "none" }
  | { readonly kind: "busy"; readonly text: string }
  | { readonly kind: "failed" }
  | { readonly kind: "reconnect" }
  | { readonly kind: "update" }

const NO_PILL: PillView = { kind: "none" }

export function pillView(phase: UpdatePhase, held: boolean, offerUpdate: boolean): PillView {
  if (phase._tag === "Updating") return { kind: "busy", text: phase.stage === "restarting" ? "Restarting" : "Updating" }
  if (held) return NO_PILL
  if (phase._tag === "Failed") return { kind: "failed" }
  if (phase._tag === "NeedsReconnect") return { kind: "reconnect" }
  return offerUpdate ? { kind: "update" } : NO_PILL
}

export function skewOf(descriptor: Descriptor | undefined, app: string): Skew | undefined {
  if (descriptor === undefined || descriptor._tag === "Unreachable") return undefined
  if (descriptor._tag === "Legacy" || descriptor.protocol !== PROTOCOL) return "blocked"
  return olderThan(descriptor.version, app) ? "update" : "ok"
}

export const updateTarget = (app: string, latest: string | undefined): string =>
  latest !== undefined && olderThan(app, latest) ? latest : app

export const LATEST_POLL_MS = 5 * 60_000
