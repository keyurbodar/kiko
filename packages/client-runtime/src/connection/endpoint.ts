import { OWNER_RPC_PATH } from "@kiko/protocol/rpc"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { compatibility, readDescriptor } from "./descriptor"
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
    detail: `${label} runs an older version than this app. It connects once it is updated.`,
    serverUpdateRequired: true,
  })

const clientBehind = (label: string) =>
  new ConnectionBlockedError({ reason: "unsupported", detail: `${label} was updated. Reload Kiko to keep going.` })

const socketUrlOf = (httpBaseUrl: string) => {
  const url = new URL(OWNER_RPC_PATH, httpBaseUrl)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  return url.toString()
}

const make = (options: OwnerEndpointOptions): OwnerEndpoint["Service"] => {
  const label = options.label ?? "Kiko"
  const http = options.fetch ?? globalThis.fetch
  const prepare = Effect.suspend(() => {
    const token = options.token()
    if (!token) return Effect.fail(signInRequired(label))
    const httpBaseUrl = options.baseUrl()
    return readDescriptor(http, httpBaseUrl).pipe(
      Effect.flatMap((descriptor) => {
        const fit = compatibility(descriptor)
        if (fit === "backend-behind") return Effect.fail(backendBehind(label))
        if (fit === "app-behind") return Effect.fail(clientBehind(label))
        return Effect.succeed<PreparedConnection>({
          label,
          httpBaseUrl,
          socketUrl: socketUrlOf(httpBaseUrl),
          protocols: [SOCKET_PROTOCOL, token],
        })
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
