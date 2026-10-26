import { PROTOCOL } from "@kiko/protocol"
import type { UserStreamItem } from "@kiko/protocol/rpc"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Ref from "effect/Ref"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as RpcClient from "effect/rpc/RpcClient"
import * as RpcClientError from "effect/rpc/RpcClientError"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import * as Socket from "effect/socket/Socket"
import { OwnerEndpoint } from "../connection/endpoint"
import {
  ConnectionBlockedError,
  ConnectionTransientError,
  type ConnectionAttemptError,
  type PreparedConnection,
} from "../connection/model"
import { makeOwnerRpcClient, PING_INTERVAL, PING_TIMEOUT, type OwnerRpcClient } from "./protocol"

const SOCKET_OPEN_TIMEOUT = "15 seconds"

export interface RpcSession {
  readonly client: OwnerRpcClient
  readonly ready: Effect.Effect<void, ConnectionAttemptError>
  readonly probe: Effect.Effect<void, ConnectionAttemptError>
  readonly closed: Effect.Effect<never, ConnectionAttemptError>
}

export class UserFeed extends Context.Service<
  UserFeed,
  {
    readonly afterSequence: Effect.Effect<number | undefined>
    readonly apply: (items: ReadonlyArray<UserStreamItem>) => Effect.Effect<void>
  }
>()("@kiko/client-runtime/rpc/UserFeed") {}

export class RpcSessionFactory extends Context.Service<
  RpcSessionFactory,
  {
    readonly connect: (connection: PreparedConnection) => Effect.Effect<RpcSession, ConnectionAttemptError, Scope.Scope>
  }
>()("@kiko/client-runtime/rpc/RpcSessionFactory") {}

export const isRpcClientError = Schema.is(RpcClientError.RpcClientError)

const unsupported = (label: string, protocol: number) =>
  protocol > PROTOCOL
    ? new ConnectionBlockedError({ reason: "unsupported", detail: `${label} was updated. Reload Kiko to keep going.` })
    : new ConnectionBlockedError({
        reason: "unsupported",
        detail: `${label} runs an older version. Update it, then reconnect.`,
        serverUpdateRequired: true,
      })

const protocolOf = (item: UserStreamItem): number | undefined =>
  item.kind === "snapshot" || item.kind === "session" ? item.protocol : undefined

function mapUserStreamError(label: string, error: unknown): ConnectionAttemptError {
  if (error instanceof ConnectionBlockedError || error instanceof ConnectionTransientError) return error
  if (isRpcClientError(error)) return new ConnectionTransientError({ reason: "transport", detail: error.message })
  const message = error instanceof Error && error.message ? error.message : `${label} could not open your chats.`
  return new ConnectionTransientError({ reason: "remote-unavailable", detail: message })
}

const make = Effect.gen(function* () {
  const webSocketConstructor = yield* Socket.WebSocketConstructor
  const endpoint = yield* OwnerEndpoint
  const feed = yield* UserFeed

  const connect = Effect.fnUntraced(function* (connection: PreparedConnection) {
    const label = connection.label
    const connected = yield* Deferred.make<void>()
    const disconnected = yield* Deferred.make<never, ConnectionAttemptError>()
    const pingTimedOut = yield* Ref.make(false)
    const hooks = RpcClient.ConnectionHooks.of({
      onConnect: Deferred.succeed(connected, undefined).pipe(Effect.asVoid),
      onDisconnect: Effect.gen(function* () {
        const wasConnected = yield* Deferred.isDone(connected)
        const timedOut = yield* Ref.get(pingTimedOut)
        const blocked = wasConnected ? null : yield* endpoint.diagnose(connection)
        const detail = !wasConnected
          ? `${label} could not establish a WebSocket connection.`
          : timedOut
            ? `${label} stopped responding for 15s.`
            : `${label} disconnected.`
        yield* Deferred.fail(disconnected, blocked ?? new ConnectionTransientError({ reason: "transport", detail }))
      }),
    })
    const layerSocket = Socket.layerWebSocket(connection.socketUrl, {
      openTimeout: SOCKET_OPEN_TIMEOUT,
      protocols: [...connection.protocols],
    }).pipe(Layer.provide(Layer.succeed(Socket.WebSocketConstructor, webSocketConstructor)))
    const layerProtocol = Layer.effect(
      RpcClient.Protocol,
      RpcClient.makeProtocolSocket({
        pingInterval: PING_INTERVAL,
        pingTimeout: PING_TIMEOUT,
        retryTransientErrors: false,
        retryPolicy: Schedule.recurs(0),
        onPingTimeout: Ref.set(pingTimedOut, true),
      }),
    ).pipe(
      Layer.provide(
        Layer.mergeAll(layerSocket, RpcSerialization.layerJson, Layer.succeed(RpcClient.ConnectionHooks, hooks)),
      ),
    )
    const protocolContext = yield* Layer.build(layerProtocol)
    const client = yield* makeOwnerRpcClient.pipe(Effect.provide(protocolContext))

    const userReady = yield* Deferred.make<void, ConnectionAttemptError>()
    const userClosed = yield* Deferred.make<never, ConnectionAttemptError>()
    const afterSequence = yield* feed.afterSequence
    const applyItems = Effect.fnUntraced(function* (items: ReadonlyArray<UserStreamItem>) {
      for (const item of items) {
        const protocol = protocolOf(item)
        if (protocol !== undefined && protocol !== PROTOCOL) return yield* unsupported(label, protocol)
      }
      yield* feed.apply(items)
      if (items.some((item) => item.kind === "synchronized")) yield* Deferred.succeed(userReady, undefined)
    })
    yield* client("user.subscribe", afterSequence === undefined ? {} : { afterSequence }).pipe(
      Stream.runForEachArray(applyItems),
      Effect.onExit((exit) => {
        if (Exit.isSuccess(exit)) {
          const ended = new ConnectionTransientError({
            reason: "remote-unavailable",
            detail: `${label} closed your chat list.`,
          })
          return Effect.all([Deferred.fail(userReady, ended), Deferred.fail(userClosed, ended)], { discard: true })
        }
        if (Cause.hasInterruptsOnly(exit.cause)) return Effect.void
        const failure = mapUserStreamError(label, Cause.squash(exit.cause))
        return Effect.all([Deferred.fail(userReady, failure), Deferred.fail(userClosed, failure)], { discard: true })
      }),
      Effect.forkScoped,
    )

    const probe = client("version.get", undefined).pipe(
      Effect.catch((error) =>
        isRpcClientError(error)
          ? Effect.fail(new ConnectionTransientError({ reason: "transport", detail: error.message }))
          : Effect.void,
      ),
      Effect.asVoid,
    )

    return {
      client,
      ready: Deferred.await(connected).pipe(
        Effect.andThen(Deferred.await(userReady)),
        Effect.raceFirst(Deferred.await(disconnected)),
      ),
      probe,
      closed: Effect.raceFirst(Deferred.await(disconnected), Deferred.await(userClosed)),
    } satisfies RpcSession
  })

  return RpcSessionFactory.of({ connect })
})

export const layer = Layer.effect(RpcSessionFactory, make)
