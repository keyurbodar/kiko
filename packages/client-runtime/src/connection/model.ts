import * as Schema from "effect/Schema"

export type NetworkStatus = "unknown" | "offline" | "online"

const ConnectionTransientReason = Schema.Literals(["network", "timeout", "transport", "remote-unavailable"])

const ConnectionBlockedReason = Schema.Literals(["authentication", "unsupported"])

export class ConnectionTransientError extends Schema.TaggedError<ConnectionTransientError>()(
  "ConnectionTransientError",
  { reason: ConnectionTransientReason, detail: Schema.String },
) {
  override get message(): string {
    return this.detail
  }
}

export class ConnectionBlockedError extends Schema.TaggedError<ConnectionBlockedError>()("ConnectionBlockedError", {
  reason: ConnectionBlockedReason,
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail
  }
}

export type ConnectionAttemptError = ConnectionTransientError | ConnectionBlockedError

export interface PreparedConnection {
  readonly label: string
  readonly httpBaseUrl: string
  readonly socketUrl: string
  readonly protocols: readonly string[]
}

export type SupervisorConnectionPhase = "available" | "offline" | "connecting" | "backoff" | "connected" | "blocked"

export type ConnectionAttemptStage = "preparing" | "opening" | "synchronizing"

export interface SupervisorConnectionState {
  readonly desired: boolean
  readonly network: NetworkStatus
  readonly phase: SupervisorConnectionPhase
  readonly stage: ConnectionAttemptStage | null
  readonly attempt: number
  readonly generation: number
  readonly lastFailure: ConnectionAttemptError | null
  readonly retryAt: number | null
}

export type ConnectionProjectionPhase = "disconnected" | "synchronizing" | "ready"

export function connectionProjectionPhase(state: SupervisorConnectionState): ConnectionProjectionPhase {
  switch (state.phase) {
    case "connecting":
      return "synchronizing"
    case "connected":
      return "ready"
    case "available":
    case "offline":
    case "backoff":
    case "blocked":
      return "disconnected"
  }
}
