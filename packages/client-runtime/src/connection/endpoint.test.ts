import { describe, expect, it } from "@effect/vitest"
import { PROTOCOL, type RoomId, type UserSnapshot } from "@kiko/protocol"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Socket from "effect/socket/Socket"
import { layer as cacheLayer, SnapshotCache, SnapshotStore } from "../platform/cache"
import type { OwnerRpcClient } from "../rpc/protocol"
import * as RpcSession from "../rpc/session"
import { layer as runtimeLayer } from "../state/runtime"
import { UserStore } from "../state/userState"
import * as Connectivity from "./connectivity"
import * as Endpoint from "./endpoint"
import type { ConnectionAttemptError, SupervisorConnectionState } from "./model"
import { make, OwnerSupervisor } from "./supervisor"
import * as ConnectionWakeups from "./wakeups"

const descriptor = (protocol: number) => ({
  kiko: 1,
  version: "0.9.0",
  protocol,
  selfUpdate: true,
  storage: "built-in",
})
const CURRENT = descriptor(PROTOCOL)
const PRE_RPC = { version: "0.7.8", protocol: PROTOCOL, storage: "built-in" }
const PRE_DESCRIPTOR = { version: "0.8.2", protocol: PROTOCOL, storage: "built-in", rpc: true }

type Answer = { readonly status: number; readonly body: unknown } | "offline"

const answerFetch = (answer: Ref.Ref<Answer>, requested: Ref.Ref<ReadonlyArray<string>>) =>
  ((input: RequestInfo | URL) => {
    Effect.runSync(Ref.update(requested, (all) => [...all, String(input)]))
    const current = Effect.runSync(Ref.get(answer))
    if (current === "offline") return Promise.reject(new TypeError("Failed to fetch"))
    return Promise.resolve(Response.json(current.body, { status: current.status }))
  }) as typeof globalThis.fetch

const awaitState = (
  state: SubscriptionRef.SubscriptionRef<SupervisorConnectionState>,
  predicate: (value: SupervisorConnectionState) => boolean,
) => SubscriptionRef.changes(state).pipe(Stream.filter(predicate), Stream.runHead, Effect.map(Option.getOrThrow))

const startAgainst = Effect.fnUntraced(function* (first: Answer) {
  const answer = yield* Ref.make(first)
  const requested = yield* Ref.make<ReadonlyArray<string>>([])
  const sockets = yield* Ref.make<ReadonlyArray<string>>([])
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
          fetch: answerFetch(answer, requested),
        }),
        Connectivity.layerAlwaysOnline,
        ConnectionWakeups.layerNone,
        Layer.succeed(RpcSession.RpcSessionFactory, sessions),
      ),
    ),
  )
  return { supervisor, answer, requested, sockets }
})

const blockedBy = (supervisor: OwnerSupervisor["Service"]) =>
  awaitState(supervisor.state, (s) => s.phase === "blocked").pipe(Effect.map((s) => s.lastFailure))

describe("OwnerEndpoint descriptor gate", () => {
  it.effect("connects over /api/rpc when the backend answers the client's protocol", () =>
    Effect.gen(function* () {
      const { supervisor, sockets } = yield* startAgainst({ status: 200, body: CURRENT })
      yield* awaitState(supervisor.state, (s) => s.phase === "connected")
      expect(yield* Ref.get(sockets)).toEqual(["ws://kiko.test/api/rpc"])
    }),
  )

  it.effect("holds a backend from before the descriptor without opening a socket, as one to update", () =>
    Effect.gen(function* () {
      const { supervisor, requested, sockets } = yield* startAgainst({ status: 200, body: PRE_RPC })
      expect(yield* blockedBy(supervisor)).toMatchObject({
        _tag: "ConnectionBlockedError",
        reason: "unsupported",
        serverUpdateRequired: true,
      })
      expect(yield* Ref.get(requested)).toEqual(["http://kiko.test/api/version"])
      expect(yield* Ref.get(sockets)).toEqual([])
    }),
  )

  it.effect("treats an RPC backend without the descriptor and one with no /api/version as legacy too", () =>
    Effect.gen(function* () {
      const rpc = yield* startAgainst({ status: 200, body: PRE_DESCRIPTOR })
      expect(yield* blockedBy(rpc.supervisor)).toMatchObject({ serverUpdateRequired: true })
      const missing = yield* startAgainst({ status: 404, body: { error: "not found" } })
      expect(yield* blockedBy(missing.supervisor)).toMatchObject({ serverUpdateRequired: true })
      expect([...(yield* Ref.get(rpc.sockets)), ...(yield* Ref.get(missing.sockets))]).toEqual([])
    }),
  )

  it.effect("holds a backend on an older protocol as one to update", () =>
    Effect.gen(function* () {
      const { supervisor, sockets } = yield* startAgainst({ status: 200, body: descriptor(PROTOCOL - 1) })
      expect(yield* blockedBy(supervisor)).toMatchObject({ reason: "unsupported", serverUpdateRequired: true })
      expect(yield* Ref.get(sockets)).toEqual([])
    }),
  )

  it.effect("asks for a reload, not a backend update, when the backend runs a newer protocol", () =>
    Effect.gen(function* () {
      const { supervisor } = yield* startAgainst({ status: 200, body: descriptor(PROTOCOL + 1) })
      const failure = yield* blockedBy(supervisor)
      expect(failure).toMatchObject({ _tag: "ConnectionBlockedError", reason: "unsupported" })
      expect(failure).not.toHaveProperty("serverUpdateRequired")
    }),
  )

  it.effect("still tries the socket when /api/version cannot be reached or fails", () =>
    Effect.gen(function* () {
      const offline = yield* startAgainst("offline")
      yield* awaitState(offline.supervisor.state, (s) => s.phase === "connected")
      const crashing = yield* startAgainst({ status: 500, body: { error: "internal error" } })
      yield* awaitState(crashing.supervisor.state, (s) => s.phase === "connected")
      expect([...(yield* Ref.get(offline.sockets)), ...(yield* Ref.get(crashing.sockets))]).toEqual([
        "ws://kiko.test/api/rpc",
        "ws://kiko.test/api/rpc",
      ])
    }),
  )

  it.effect("connects on a retry once the backend answers the client's protocol", () =>
    Effect.gen(function* () {
      const { supervisor, answer, sockets } = yield* startAgainst({ status: 200, body: descriptor(PROTOCOL - 1) })
      yield* blockedBy(supervisor)
      yield* Ref.set(answer, { status: 200, body: CURRENT })
      yield* supervisor.retryNow
      yield* awaitState(supervisor.state, (s) => s.phase === "connected")
      expect(yield* Ref.get(sockets)).toEqual(["ws://kiko.test/api/rpc"])
    }),
  )
})

const ROOM = "01890000-0000-7000-8000-000000000001" as RoomId

const CACHED: UserSnapshot = {
  seq: 4,
  chats: [
    {
      roomId: ROOM,
      title: "Trip plans",
      pinned: false,
      muted: false,
      lastSeq: 3,
      lastPreview: "See you at noon",
      unread: 0,
      updatedAt: 1,
    },
  ],
  home: { files: [], folders: [] },
}

const seededStore = Effect.gen(function* () {
  const values = new Map<string, string>()
  const store = SnapshotStore.of({
    read: (key) => Effect.sync(() => Option.fromNullishOr(values.get(key))),
    write: (key, value) => Effect.sync(() => void values.set(key, value)),
    remove: (key) => Effect.sync(() => void values.delete(key)),
  })
  const cache = yield* SnapshotCache.pipe(
    Effect.provide(cacheLayer.pipe(Layer.provide(Layer.succeed(SnapshotStore, store)))),
  )
  yield* cache.saveUser({ sequence: 4, snapshot: CACHED })
  return store
})

const silentSocket = (dialed: Deferred.Deferred<string>) =>
  Layer.succeed(Socket.WebSocketConstructor, (url) => {
    Deferred.doneUnsafe(dialed, Effect.succeed(url))
    return {
      readyState: 0,
      addEventListener: () => {},
      removeEventListener: () => {},
      close: () => {},
      send: () => {},
    }
  })

describe("owner runtime while the backend is incompatible", () => {
  it.effect("keeps the cached chat list readable, then dials the socket without a reload once it matches", () =>
    Effect.gen(function* () {
      const answer = yield* Ref.make<Answer>({ status: 200, body: descriptor(PROTOCOL - 1) })
      const requested = yield* Ref.make<ReadonlyArray<string>>([])
      const dialed = yield* Deferred.make<string>()
      const context = yield* Layer.build(
        runtimeLayer({
          endpoint: { baseUrl: () => "http://kiko.test", token: () => "token", fetch: answerFetch(answer, requested) },
          connect: true,
          store: Layer.succeed(SnapshotStore, yield* seededStore),
          connectivity: Connectivity.layerAlwaysOnline,
          wakeups: ConnectionWakeups.layerNone,
          webSocket: silentSocket(dialed),
        }),
      )
      const supervisor = Context.get(context, OwnerSupervisor)
      const user = Context.get(context, UserStore)
      const titles = SubscriptionRef.get(user.state).pipe(
        Effect.map((state) => Option.getOrUndefined(state.data)?.chats.map((chat) => chat.title)),
      )

      yield* blockedBy(supervisor)
      expect(yield* titles).toEqual(["Trip plans"])

      yield* Ref.set(answer, { status: 200, body: CURRENT })
      yield* supervisor.retryNow
      expect(yield* Deferred.await(dialed)).toBe("ws://kiko.test/api/rpc")
      expect(yield* titles).toEqual(["Trip plans"])
    }).pipe(Effect.scoped),
  )
})
