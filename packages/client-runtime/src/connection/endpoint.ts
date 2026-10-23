import { speaksRpc } from "@kiko/protocol"
import { OWNER_RPC_PATH } from "@kiko/protocol/rpc"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { ConnectionBlockedError, type PreparedConnection } from "./model"

const SOCKET_PROTOCOL = "kiko"

export class OwnerEndpoint extends Context.Service<
  OwnerEndpoint,
  {
    readonly prepare: Effect.Effect<PreparedConnection, ConnectionBlockedError>
    readonly diagnose: (prepared: PreparedConnection) => Effect.Effect<ConnectionBlockedError | null>
  }
>()("@kiko/client-runtime/connection/OwnerEndpoint") {}

export interface OwnerEndpointOptions {
  readonly label?: string
  readonly baseUrl: () => string
  readonly token: () => string | null
  readonly fetch?: typeof globalThis.fetch
}

const signInRequired = (label: string) =>
  new ConnectionBlockedError({ reason: "authentication", detail: `Sign in to connect to ${label}.` })

const backendBehind = (label: string) =>
  new ConnectionBlockedError({
    reason: "unsupported",
    detail: `${label} runs an older version that this app cannot connect to. Update it to keep going.`,
    serverUpdateRequired: true,
  })

const predatesRpc = (build: unknown): boolean => typeof build === "object" && build !== null && !speaksRpc(build)

const socketUrlOf = (httpBaseUrl: string) => {
  const url = new URL(OWNER_RPC_PATH, httpBaseUrl)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.toString()
}

const make = (options: OwnerEndpointOptions): OwnerEndpoint["Service"] => {
  const label = options.label ?? "Kiko"
  const http = options.fetch ?? globalThis.fetch
  const checkBuild = (httpBaseUrl: string) =>
    Effect.tryPromise(async (signal) => {
      const response = await http(new URL("/api/version", httpBaseUrl), { cache: "no-store", signal })
      return response.ok ? ((await response.json()) as unknown) : null
    }).pipe(
      Effect.timeout("5 seconds"),
      Effect.orElseSucceed(() => null),
      Effect.flatMap((build) => (predatesRpc(build) ? Effect.fail(backendBehind(label)) : Effect.void)),
    )
  const prepare = Effect.suspend(() => {
    const token = options.token()
    if (!token) return Effect.fail(signInRequired(label))
    const httpBaseUrl = options.baseUrl()
    return checkBuild(httpBaseUrl).pipe(
      Effect.as<PreparedConnection>({
        label,
        httpBaseUrl,
        socketUrl: socketUrlOf(httpBaseUrl),
        protocols: [SOCKET_PROTOCOL, token],
      }),
    )
  })
  const diagnose = (prepared: PreparedConnection) =>
    Effect.tryPromise((signal) =>
      http(new URL("/api/me", prepared.httpBaseUrl), {
        headers: { authorization: `Bearer ${prepared.protocols[1] ?? ""}` },
        cache: "no-store",
        signal,
      }),
    ).pipe(
      Effect.timeout("5 seconds"),
      Effect.map((response) =>
        response.status === 401 || response.status === 403
          ? new ConnectionBlockedError({
              reason: "authentication",
              detail: `Your session with ${label} ended. Sign in again.`,
            })
          : null,
      ),
      Effect.orElseSucceed(() => null),
    )
  return OwnerEndpoint.of({ prepare, diagnose })
}

export const layer = (options: OwnerEndpointOptions) => Layer.succeed(OwnerEndpoint, make(options))
