import { describe, expect, it } from "@effect/vitest"
import * as Clock from "effect/Clock"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Random from "effect/Random"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as TestClock from "effect/testing/TestClock"
import * as RpcSession from "../rpc/session"
import type { OwnerRpcClient } from "../rpc/protocol"
import * as Connectivity from "./connectivity"
import { OwnerEndpoint } from "./endpoint"
import {
  ConnectionBlockedError,
  ConnectionTransientError,
  type ConnectionAttemptError,
  type NetworkStatus,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "./model"
import { make, retryDelayMs } from "./supervisor"
import * as ConnectionWakeups from "./wakeups"

const PREPARED: PreparedConnection = {
  label: "Kiko",
  httpBaseUrl: "http://kiko.test",
  socketUrl: "ws://kiko.test/api/rpc",
  protocols: ["kiko", "token"],
}

const transient = (detail = "Kiko disconnected.") => new ConnectionTransientError({ reason: "transport", detail })
const blocked = () => new ConnectionBlockedError({ reason: "authentication", detail: "Sign in to connect to Kiko." })

const awaitState = (
  state: SubscriptionRef.SubscriptionRef<SupervisorConnectionState>,
  predicate: (value: SupervisorConnectionState) => boolean,
) => SubscriptionRef.changes(state).pipe(Stream.filter(predicate), Stream.runHead, Effect.map(Option.getOrThrow))

interface HarnessOptions {
  readonly network?: NetworkStatus
  readonly prepare?: (attempt: number) => Effect.Effect<PreparedConnection, ConnectionBlockedError>
  readonly ready?: (attempt: number) => Effect.Effect<void, ConnectionAttemptError>
  readonly probe?: (attempt: number) => Effect.Effect<void, ConnectionAttemptError>
}

const makeHarness = Effect.fnUntraced(function* (options: HarnessOptions = {}) {
  const network = yield* SubscriptionRef.make<NetworkStatus>(options.network ?? "online")
  const wakeups = yield* SubscriptionRef.make({
    sequence: 0,
    reason: "application-active" as ConnectionWakeups.ConnectionWakeup,
  })
  const prepareCount = yield* Ref.make(0)
  const sessionCount = yield* Ref.make(0)
  const probeCount = yield* Ref.make(0)
  const closers = yield* Ref.make<ReadonlyArray<Deferred.Deferred<never, ConnectionAttemptError>>>([])

  const endpoint = OwnerEndpoint.of({
    prepare: Ref.updateAndGet(prepareCount, (n) => n + 1).pipe(
      Effect.flatMap((attempt) => options.prepare?.(attempt) ?? Effect.succeed(PREPARED)),
    ),
    diagnose: () => Effect.succeed(null),
  })
  const sessions = RpcSession.RpcSessionFactory.of({
    connect: () =>
      Effect.gen(function* () {
        const attempt = yield* Ref.updateAndGet(sessionCount, (n) => n + 1)
        const closed = yield* Deferred.make<never, ConnectionAttemptError>()
        yield* Ref.update(closers, (all) => [...all, closed])
        return {
          client: (() => Effect.die("unused")) as unknown as OwnerRpcClient,
          ready: options.ready?.(attempt) ?? Effect.void,
          probe: Ref.update(probeCount, (n) => n + 1).pipe(Effect.andThen(options.probe?.(attempt) ?? Effect.void)),
          closed: Deferred.await(closed),
        } satisfies RpcSession.RpcSession
      }),
  })
  const dependencies = Layer.mergeAll(
    Layer.succeed(Random.Random, { nextDoubleUnsafe: () => 1 - Number.EPSILON, nextIntUnsafe: () => 0 }),
    Connectivity.layer({ status: SubscriptionRef.get(network), changes: SubscriptionRef.changes(network) }),
    ConnectionWakeups.layer({
      changes: SubscriptionRef.changes(wakeups).pipe(
        Stream.drop(1),
        Stream.map((event) => event.reason),
      ),
    }),
    Layer.succeed(OwnerEndpoint, endpoint),
    Layer.succeed(RpcSession.RpcSessionFactory, sessions),
  )
  return {
    dependencies,
    prepareCount,
    sessionCount,
    probeCount,
    setNetwork: (status: NetworkStatus) => SubscriptionRef.set(network, status),
    wake: (reason: ConnectionWakeups.ConnectionWakeup) =>
      SubscriptionRef.update(wakeups, (event) => ({ sequence: event.sequence + 1, reason })),
    dropLatest: (error: ConnectionAttemptError = transient()) =>
      Ref.get(closers).pipe(
        Effect.flatMap((all) => (all.length === 0 ? Effect.void : Deferred.fail(all[all.length - 1]!, error))),
      ),
  }
})

const start = (harness: Effect.Success<ReturnType<typeof makeHarness>>, initiallyDesired = true) =>
  make({ initiallyDesired }).pipe(Effect.provide(harness.dependencies))

describe("retryDelayMs", () => {
  it("doubles from one second with equal jitter and caps at five minutes", () => {
    expect([0, 1, 2, 3].map((n) => retryDelayMs(n, 0))).toEqual([1_000, 2_000, 4_000, 8_000])
    expect([0, 1, 2, 3].map((n) => retryDelayMs(n, 1))).toEqual([2_000, 4_000, 8_000, 16_000])
    expect(retryDelayMs(20, 1)).toBe(300_000)
    expect(retryDelayMs(20, 0)).toBe(150_000)
  })
})

describe("OwnerSupervisor", () => {
  it.effect("stays available until a connection is desired", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness()
      const supervisor = yield* start(harness, false)
      expect((yield* SubscriptionRef.get(supervisor.state)).phase).toBe("available")
      expect(yield* Ref.get(harness.prepareCount)).toBe(0)
      yield* supervisor.connect
      const connected = yield* awaitState(supervisor.state, (s) => s.phase === "connected")
      expect(connected.generation).toBe(1)
      expect(Option.isSome(yield* SubscriptionRef.get(supervisor.session))).toBe(true)
    }),
  )

  it.effect("is connected only once the session reports ready", () =>
    Effect.gen(function* () {
      const ready = yield* Deferred.make<void, ConnectionAttemptError>()
      const harness = yield* makeHarness({ ready: () => Deferred.await(ready) })
      const supervisor = yield* start(harness)
      const syncing = yield* awaitState(supervisor.state, (s) => s.stage === "synchronizing")
      expect(syncing.phase).toBe("connecting")
      expect(Option.isNone(yield* SubscriptionRef.get(supervisor.session))).toBe(true)
      yield* Deferred.succeed(ready, undefined)
      yield* awaitState(supervisor.state, (s) => s.phase === "connected")
    }),
  )

  it.effect("backs off with a doubling ladder and retries when the delay elapses", () =>
    Effect.gen(function* () {
      const failing = yield* makeHarness({
        ready: (attempt) => (attempt <= 3 ? Effect.fail(transient()) : Effect.void),
      })
      const supervisor = yield* start(failing)
      const first = yield* awaitState(supervisor.state, (s) => s.phase === "backoff")
      expect(first.attempt).toBe(1)
      expect(first.retryAt).toBe(2_000)
      expect(first.lastFailure?.message).toBe("Kiko disconnected.")

      yield* TestClock.adjust("1999 millis")
      expect(yield* Ref.get(failing.sessionCount)).toBe(1)
      yield* TestClock.adjust("1 millis")
      const second = yield* awaitState(supervisor.state, (s) => s.phase === "backoff" && s.attempt === 2)
      expect(second.retryAt).toBe(2_000 + 4_000)

      yield* TestClock.adjust("4 seconds")
      const third = yield* awaitState(supervisor.state, (s) => s.phase === "backoff" && s.attempt === 3)
      expect(third.retryAt).toBe(6_000 + 8_000)

      yield* TestClock.adjust("8 seconds")
      yield* awaitState(supervisor.state, (s) => s.phase === "connected")
      expect(yield* Ref.get(failing.sessionCount)).toBe(4)
    }),
  )

  it.effect("a wakeup fires a pending retry at once and resets the ladder", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        ready: (attempt) => (attempt <= 2 ? Effect.fail(transient()) : Effect.void),
      })
      const supervisor = yield* start(harness)
      yield* awaitState(supervisor.state, (s) => s.phase === "backoff" && s.attempt === 1)
      yield* TestClock.adjust("2 seconds")
      yield* awaitState(supervisor.state, (s) => s.phase === "backoff" && s.attempt === 2)
      yield* harness.wake("application-active")
      yield* awaitState(supervisor.state, (s) => s.phase === "connected" && s.attempt === 1)
    }),
  )

  it.effect("blocks on auth failure and never retries until the user or platform asks", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        prepare: (attempt) => (attempt === 1 ? Effect.fail(blocked()) : Effect.succeed(PREPARED)),
      })
      const supervisor = yield* start(harness)
      const state = yield* awaitState(supervisor.state, (s) => s.phase === "blocked")
      expect(state.lastFailure?._tag).toBe("ConnectionBlockedError")
      expect(state.retryAt).toBeNull()
      yield* TestClock.adjust("1 hour")
      expect(yield* Ref.get(harness.prepareCount)).toBe(1)
      yield* supervisor.retryNow
      yield* awaitState(supervisor.state, (s) => s.phase === "connected")
      expect(yield* Ref.get(harness.prepareCount)).toBe(2)
    }),
  )

  it.effect("waits while offline without attempts and connects when the network returns", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ network: "offline" })
      const supervisor = yield* start(harness)
      yield* awaitState(supervisor.state, (s) => s.phase === "offline")
      yield* TestClock.adjust("10 minutes")
      expect(yield* Ref.get(harness.prepareCount)).toBe(0)
      yield* harness.setNetwork("online")
      yield* awaitState(supervisor.state, (s) => s.phase === "connected")
      expect(yield* Ref.get(harness.prepareCount)).toBe(1)
    }),
  )

  it.effect("probes the live session on return to the tab instead of replacing it", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness()
      const supervisor = yield* start(harness)
      yield* awaitState(supervisor.state, (s) => s.phase === "connected")
      yield* harness.wake("application-active")
      yield* TestClock.adjust("1 minute")
      yield* harness.setNetwork("offline")
      yield* TestClock.adjust("1 minute")
      const state = yield* SubscriptionRef.get(supervisor.state)
      expect(state.phase).toBe("connected")
      expect(state.generation).toBe(1)
      expect(yield* Ref.get(harness.probeCount)).toBe(2)
      expect(yield* Ref.get(harness.sessionCount)).toBe(1)
    }),
  )

  it.effect("replaces the session at attempt 1 when the visibility probe goes unanswered for 15 seconds", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ probe: (attempt) => (attempt === 1 ? Effect.never : Effect.void) })
      const supervisor = yield* start(harness)
      yield* awaitState(supervisor.state, (s) => s.phase === "connected")
      yield* harness.wake("application-active")
      yield* Effect.yieldNow
      yield* TestClock.adjust("14999 millis")
      expect((yield* SubscriptionRef.get(supervisor.state)).generation).toBe(1)
      yield* TestClock.adjust("1 millis")
      const replaced = yield* awaitState(supervisor.state, (s) => s.phase === "connected" && s.generation === 2)
      expect(replaced.attempt).toBe(1)
      expect(yield* Ref.get(harness.sessionCount)).toBe(2)
    }),
  )

  it.effect("gives an explicit retry's probe 3 seconds", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({ probe: (attempt) => (attempt === 1 ? Effect.never : Effect.void) })
      const supervisor = yield* start(harness)
      yield* awaitState(supervisor.state, (s) => s.phase === "connected")
      yield* supervisor.retryNow
      yield* Effect.yieldNow
      yield* TestClock.adjust("3 seconds")
      yield* awaitState(supervisor.state, (s) => s.phase === "connected" && s.generation === 2)
    }),
  )

  it.effect("resets the ladder only after a session stayed up for 30 seconds", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        ready: (attempt) => (attempt === 1 ? Effect.fail(transient()) : Effect.void),
      })
      const supervisor = yield* start(harness)
      yield* awaitState(supervisor.state, (s) => s.phase === "backoff" && s.attempt === 1)
      yield* TestClock.adjust("2 seconds")
      yield* awaitState(supervisor.state, (s) => s.phase === "connected" && s.attempt === 2)

      yield* TestClock.adjust("10 seconds")
      yield* harness.dropLatest()
      const flapping = yield* awaitState(supervisor.state, (s) => s.phase === "backoff")
      expect(flapping.attempt).toBe(2)
      expect(flapping.lastFailure).toBeNull()
      expect(flapping.retryAt! - (yield* Clock.currentTimeMillis)).toBe(4_000)

      yield* TestClock.adjust("4 seconds")
      yield* awaitState(supervisor.state, (s) => s.phase === "connected" && s.attempt === 3)
      yield* TestClock.adjust("30 seconds")
      yield* harness.dropLatest()
      const stable = yield* awaitState(supervisor.state, (s) => s.phase === "backoff")
      expect(stable.attempt).toBe(3)
      expect(stable.retryAt! - (yield* Clock.currentTimeMillis)).toBe(2_000)
    }),
  )

  it.effect("clears the session and stays available after disconnect", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness()
      const supervisor = yield* start(harness)
      yield* awaitState(supervisor.state, (s) => s.phase === "connected")
      yield* supervisor.disconnect
      yield* awaitState(supervisor.state, (s) => s.phase === "available")
      expect(Option.isNone(yield* SubscriptionRef.get(supervisor.session))).toBe(true)
    }),
  )
})
