import { describe, expect, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type { OwnerRpcClient } from "../rpc/protocol"
import * as RpcSession from "../rpc/session"
import * as Connectivity from "./connectivity"
import * as Endpoint from "./endpoint"
import type { ConnectionAttemptError, SupervisorConnectionState } from "./model"
import { make } from "./supervisor"
import * as ConnectionWakeups from "./wakeups"

const OLD_BUILD = { version: "0.7.8", protocol: 3, storage: "built-in" }
const RPC_BUILD = { version: "0.8.0", protocol: 3, storage: "built-in", rpc: true }

const awaitState = (
  state: SubscriptionRef.SubscriptionRef<SupervisorConnectionState>,
  predicate: (value: SupervisorConnectionState) => boolean,
) => SubscriptionRef.changes(state).pipe(Stream.filter(predicate), Stream.runHead, Effect.map(Option.getOrThrow))

const startAgainst = Effect.fnUntraced(function* (build: object) {
  const requested = yield* Ref.make<ReadonlyArray<string>>([])
  const sockets = yield* Ref.make<ReadonlyArray<string>>([])
  const fetch = (input: RequestInfo | URL) => {
    Effect.runSync(Ref.update(requested, (all) => [...all, String(input)]))
    return Promise.resolve(Response.json(build))
  }
  const sessions = RpcSession.RpcSessionFactory.of({
    connect: (connection) =>
      Effect.gen(function* () {
        yield* Ref.update(sockets, (all) => [...all, connection.socketUrl])
        const closed = yield* Deferred.make<never, ConnectionAttemptError>()
        return {
          client: (() => Effect.die("unused")) as unknown as OwnerRpcClient,
          ready: Effect.void,
          probe: Effect.void,
          closed: Deferred.await(closed),
        } satisfies RpcSession.RpcSession
      }),
  })
  const supervisor = yield* make({ initiallyDesired: true }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Endpoint.layer({
          baseUrl: () => "http://kiko.test",
          token: () => "token",
          fetch: fetch as typeof globalThis.fetch,
        }),
        Connectivity.layerAlwaysOnline,
        ConnectionWakeups.layerNone,
        Layer.succeed(RpcSession.RpcSessionFactory, sessions),
      ),
    ),
  )
  return { supervisor, requested, sockets }
})

describe("OwnerEndpoint version gate", () => {
  it.effect("blocks without opening a socket when the backend predates the RPC transport", () =>
    Effect.gen(function* () {
      const { supervisor, requested, sockets } = yield* startAgainst(OLD_BUILD)
      const blocked = yield* awaitState(supervisor.state, (s) => s.phase === "blocked")
      expect(blocked.lastFailure).toMatchObject({
        _tag: "ConnectionBlockedError",
        reason: "unsupported",
        serverUpdateRequired: true,
      })
      expect(yield* Ref.get(requested)).toEqual(["http://kiko.test/api/version"])
      expect(yield* Ref.get(sockets)).toEqual([])
    }),
  )

  it.effect("connects over /api/rpc when the backend speaks RPC", () =>
    Effect.gen(function* () {
      const { supervisor, sockets } = yield* startAgainst(RPC_BUILD)
      yield* awaitState(supervisor.state, (s) => s.phase === "connected")
      expect(yield* Ref.get(sockets)).toEqual(["ws://kiko.test/api/rpc"])
    }),
  )
})
