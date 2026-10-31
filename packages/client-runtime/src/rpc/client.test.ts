import type { RoomId } from "@kiko/protocol"
import type { RoomStreamItem } from "@kiko/protocol/rpc"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import { RpcClientDefect, RpcClientError } from "effect/rpc/RpcClientError"
import * as Socket from "effect/socket/Socket"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as TestClock from "effect/testing/TestClock"
import type { PreparedConnection, SupervisorConnectionState } from "../connection/model"
import { OwnerSupervisor } from "../connection/supervisor"
import { subscribe } from "./client"
import type { OwnerRpcClient } from "./protocol"
import type { RpcSession } from "./session"

const ROOM = "01890000-0000-7000-8000-000000000004" as RoomId

const CONNECTED: SupervisorConnectionState = {
  desired: true,
  network: "online",
  phase: "connected",
  stage: null,
  attempt: 0,
  generation: 1,
  lastFailure: null,
  retryAt: null,
}

const settle = Effect.repeat(Effect.yieldNow, { times: 50 })

const closed = () => Stream.fail(new RpcClientError({ reason: new Socket.SocketCloseError({ code: 1006 }) }))

const harness = Effect.fnUntraced(function* (client: OwnerRpcClient) {
  const session: RpcSession = { client, ready: Effect.void, probe: Effect.void, closed: Effect.never }
  const supervisor = OwnerSupervisor.of({
    state: yield* SubscriptionRef.make(CONNECTED),
    session: yield* SubscriptionRef.make(Option.some(session)),
    prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  })
  const received = yield* Ref.make<ReadonlyArray<RoomStreamItem>>([])
  yield* subscribe("room.subscribe", () => Effect.succeed({ roomId: ROOM }), {
    retryExpectedFailureAfter: "250 millis",
  }).pipe(
    Stream.runForEach((item) => Ref.update(received, (all) => [...all, item])),
    Effect.provideService(OwnerSupervisor, supervisor),
    Effect.forkScoped,
  )
  return received
})

describe("a stream that loses its transport", () => {
  it.effect("reopens after a recoverable error instead of going quiet", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let attempts = 0
        const client = (() => {
          attempts += 1
          return attempts === 1 ? closed() : Stream.make({ kind: "synchronized" } as const)
        }) as unknown as OwnerRpcClient
        const received = yield* harness(client)
        yield* settle
        expect(attempts).toBe(1)

        yield* TestClock.adjust("250 millis")
        yield* settle
        expect(attempts).toBe(2)
        expect(yield* Ref.get(received)).toEqual([{ kind: "synchronized" }])
      }),
    ),
  )

  it.effect("backs off further each time the reopen keeps failing", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let attempts = 0
        const client = (() => {
          attempts += 1
          return closed()
        }) as unknown as OwnerRpcClient
        yield* harness(client)
        yield* settle
        expect(attempts).toBe(1)

        yield* TestClock.adjust("250 millis")
        yield* settle
        expect(attempts).toBe(2)

        yield* TestClock.adjust("250 millis")
        yield* settle
        expect(attempts).toBe(2)

        yield* TestClock.adjust("250 millis")
        yield* settle
        expect(attempts).toBe(3)
      }),
    ),
  )

  it.effect("stays ended on a protocol defect instead of looping", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let attempts = 0
        const client = (() => {
          attempts += 1
          return Stream.fail(
            new RpcClientError({
              reason: new RpcClientDefect({ message: "bad frame", cause: new Error("bad frame") }),
            }),
          )
        }) as unknown as OwnerRpcClient
        yield* harness(client)
        yield* settle
        yield* TestClock.adjust("10 seconds")
        yield* settle
        expect(attempts).toBe(1)
      }),
    ),
  )
})
