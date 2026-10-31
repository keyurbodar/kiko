import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Random from "effect/Random"
import * as Ref from "effect/Ref"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as RpcSession from "../rpc/session"
import * as Connectivity from "./connectivity"
import { OwnerEndpoint } from "./endpoint"
import {
  ConnectionTransientError,
  type ConnectionAttemptError,
  type ConnectionAttemptStage,
  type NetworkStatus,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "./model"
import * as ConnectionWakeups from "./wakeups"

const RETRY_BASE_DELAY_MS = 1_000
const RETRY_MAX_DELAY_MS = 300_000
const ESTABLISHMENT_TIMEOUT = Duration.fromInputUnsafe("15 seconds")
const SYNCHRONIZATION_TIMEOUT = Duration.fromInputUnsafe("75 seconds")
const CONNECTION_PROBE_TIMEOUT = "15 seconds"
const QUICK_CONNECTION_PROBE_TIMEOUT = "3 seconds"
const BACKOFF_RESET_AFTER_MS = 30_000

interface SupervisorIntent {
  readonly desired: boolean
  readonly network: NetworkStatus
}

type SupervisorSignal =
  | { readonly _tag: "ConnectRequested" }
  | { readonly _tag: "DisconnectRequested" }
  | { readonly _tag: "RetryRequested" }
  | { readonly _tag: "NetworkChanged"; readonly network: NetworkStatus }
  | { readonly _tag: "Wakeup"; readonly reason: ConnectionWakeups.ConnectionWakeup }

type AttemptOutcome =
  | { readonly _tag: "Interrupted"; readonly established: boolean; readonly stable: boolean }
  | {
      readonly _tag: "Failure"
      readonly established: boolean
      readonly stable: boolean
      readonly error: ConnectionAttemptError
      readonly unansweredProbe: boolean
    }

type EstablishmentEvent =
  | { readonly _tag: "Completed"; readonly exit: Exit.Exit<RpcSession.RpcSession, ConnectionAttemptError> }
  | { readonly _tag: "Interrupted" }
  | { readonly _tag: "TimedOut" }

export function retryDelayMs(failureCount: number, random: number): number {
  const ceiling = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** (failureCount + 1))
  return Math.round(ceiling / 2 + (ceiling / 2) * random)
}

function exitUnlessInterrupted<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<Exit.Exit<A, E>, never, R> {
  return Effect.matchCauseEffect(effect, {
    onFailure: (cause) => (Cause.hasInterrupts(cause) ? Effect.interrupt : Effect.succeed(Exit.failCause(cause))),
    onSuccess: (value) => Effect.succeed(Exit.succeed(value)),
  })
}

function failureFromExit<A>(
  exit: Exit.Exit<A, ConnectionAttemptError>,
  established: boolean,
  stable: boolean,
  unansweredProbe = false,
): AttemptOutcome {
  if (Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)) return { _tag: "Interrupted", established, stable }
  const typed = exit.cause.reasons.find(Cause.isFailReason)
  return {
    _tag: "Failure",
    established,
    stable,
    unansweredProbe,
    error:
      typed?.error ??
      new ConnectionTransientError({ reason: "transport", detail: "Kiko's connection failed unexpectedly." }),
  }
}

const probeTimedOut = (error: ConnectionAttemptError): boolean =>
  error._tag === "ConnectionTransientError" && error.reason === "timeout"

const baseState = (
  intent: SupervisorIntent,
  phase: SupervisorConnectionState["phase"],
  generation: number,
  attempt: number,
  lastFailure: ConnectionAttemptError | null,
): SupervisorConnectionState => ({
  desired: phase === "available" ? false : intent.desired,
  network: intent.network,
  phase,
  stage: null,
  attempt,
  generation,
  lastFailure,
  retryAt: null,
})

const connectingState = (
  intent: SupervisorIntent,
  generation: number,
  attempt: number,
  lastFailure: ConnectionAttemptError | null,
  stage: ConnectionAttemptStage = "preparing",
): SupervisorConnectionState => ({ ...baseState(intent, "connecting", generation, attempt, lastFailure), stage })

export class OwnerSupervisor extends Context.Service<
  OwnerSupervisor,
  {
    readonly state: SubscriptionRef.SubscriptionRef<SupervisorConnectionState>
    readonly session: SubscriptionRef.SubscriptionRef<Option.Option<RpcSession.RpcSession>>
    readonly prepared: SubscriptionRef.SubscriptionRef<Option.Option<PreparedConnection>>
    readonly connect: Effect.Effect<void>
    readonly disconnect: Effect.Effect<void>
    readonly retryNow: Effect.Effect<void>
  }
>()("@kiko/client-runtime/connection/OwnerSupervisor") {}

export interface OwnerSupervisorOptions {
  readonly initiallyDesired?: boolean
}

export const make = Effect.fn("OwnerSupervisor.make")(function* (
  options?: OwnerSupervisorOptions,
): Effect.fn.Return<
  OwnerSupervisor["Service"],
  never,
  | Connectivity.Connectivity
  | ConnectionWakeups.ConnectionWakeups
  | OwnerEndpoint
  | RpcSession.RpcSessionFactory
  | Scope.Scope
> {
  const connectivity = yield* Connectivity.Connectivity
  const wakeups = yield* ConnectionWakeups.ConnectionWakeups
  const endpoint = yield* OwnerEndpoint
  const sessions = yield* RpcSession.RpcSessionFactory
  const initialIntent: SupervisorIntent = {
    desired: options?.initiallyDesired ?? false,
    network: yield* connectivity.status,
  }
  const intent = yield* Ref.make(initialIntent)
  const signals = yield* Queue.unbounded<SupervisorSignal>()
  const resetRetryState = yield* Ref.make(false)
  const state = yield* SubscriptionRef.make<SupervisorConnectionState>(
    !initialIntent.desired
      ? baseState(initialIntent, "available", 0, 0, null)
      : initialIntent.network === "offline"
        ? baseState(initialIntent, "offline", 0, 0, null)
        : connectingState(initialIntent, 0, 1, null),
  )
  const session = yield* SubscriptionRef.make<Option.Option<RpcSession.RpcSession>>(Option.none())
  const prepared = yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(Option.none())

  const clearLease = Effect.all(
    [SubscriptionRef.set(session, Option.none()), SubscriptionRef.set(prepared, Option.none())],
    {
      discard: true,
    },
  )
  const setState = (next: SupervisorConnectionState) => SubscriptionRef.set(state, next)
  const signal = (next: SupervisorSignal) => Queue.offer(signals, next).pipe(Effect.asVoid)

  const reportStage = Effect.fnUntraced(function* (
    attempt: number,
    generation: number,
    lastFailure: ConnectionAttemptError | null,
    stage: ConnectionAttemptStage,
  ) {
    yield* setState(connectingState(yield* Ref.get(intent), generation, attempt, lastFailure, stage))
  })

  const establish = Effect.fnUntraced(function* (
    attempt: number,
    generation: number,
    lastFailure: ConnectionAttemptError | null,
    synchronizing: Ref.Ref<boolean>,
  ) {
    yield* reportStage(attempt, generation, lastFailure, "preparing")
    const connection = yield* endpoint.prepare
    yield* SubscriptionRef.set(prepared, Option.some(connection))
    yield* reportStage(attempt, generation, lastFailure, "opening")
    const opened = yield* sessions.connect(connection)
    yield* Ref.set(synchronizing, true)
    yield* reportStage(attempt, generation, lastFailure, "synchronizing")
    yield* opened.ready
    return opened
  })

  const waitForEstablishmentInterrupt = Effect.fnUntraced(function* () {
    for (;;) {
      const next = yield* Queue.take(signals)
      if (next._tag === "DisconnectRequested" || next._tag === "RetryRequested") return
      if (next._tag === "NetworkChanged" && next.network === "offline") return
    }
  })

  const establishmentDeadline = Effect.fnUntraced(function* (synchronizing: Ref.Ref<boolean>) {
    const startedAt = yield* Clock.currentTimeMillis
    for (;;) {
      const budget =
        Duration.toMillis(ESTABLISHMENT_TIMEOUT) +
        ((yield* Ref.get(synchronizing)) ? Duration.toMillis(SYNCHRONIZATION_TIMEOUT) : 0)
      const remaining = startedAt + budget - (yield* Clock.currentTimeMillis)
      if (remaining <= 0) return
      yield* Effect.sleep(Duration.millis(Math.min(remaining, Duration.toMillis(ESTABLISHMENT_TIMEOUT))))
    }
  })

  const probeTimeoutFor = (next: SupervisorSignal): Duration.Input | undefined => {
    switch (next._tag) {
      case "RetryRequested":
        return QUICK_CONNECTION_PROBE_TIMEOUT
      case "NetworkChanged":
        return next.network === "offline" ? QUICK_CONNECTION_PROBE_TIMEOUT : undefined
      case "Wakeup":
        return next.reason === "application-active" ? CONNECTION_PROBE_TIMEOUT : QUICK_CONNECTION_PROBE_TIMEOUT
      case "ConnectRequested":
      case "DisconnectRequested":
        return undefined
    }
  }

  const takeConnectedSignal = Queue.take(signals).pipe(
    Effect.tap((next) => (next._tag === "RetryRequested" ? Ref.set(resetRetryState, false) : Effect.void)),
  )

  const awaitProbe = Effect.fnUntraced(function* (live: RpcSession.RpcSession, timeout: Duration.Input) {
    const probe = yield* Effect.forkChild(live.probe)
    let deadline = (yield* Clock.currentTimeMillis) + Duration.toMillis(Duration.fromInputUnsafe(timeout))
    for (;;) {
      const remaining = deadline - (yield* Clock.currentTimeMillis)
      const event = yield* Effect.raceAllFirst([
        Fiber.await(probe).pipe(Effect.map((exit) => ({ _tag: "ProbeCompleted" as const, exit }))),
        takeConnectedSignal.pipe(Effect.map((next) => ({ _tag: "Signal" as const, next }))),
        Effect.sleep(Duration.millis(Math.max(0, remaining))).pipe(Effect.as({ _tag: "TimedOut" as const })),
      ])
      if (event._tag === "TimedOut") {
        yield* Fiber.interrupt(probe)
        return yield* new ConnectionTransientError({
          reason: "timeout",
          detail: "Kiko did not respond to a connection health check.",
        })
      }
      if (event._tag === "ProbeCompleted") return yield* event.exit
      if (event.next._tag === "DisconnectRequested") {
        yield* Fiber.interrupt(probe)
        return "end" as const
      }
      const sooner = probeTimeoutFor(event.next)
      if (sooner !== undefined) {
        const signalDeadline = (yield* Clock.currentTimeMillis) + Duration.toMillis(Duration.fromInputUnsafe(sooner))
        if (signalDeadline < deadline) deadline = signalDeadline
      }
    }
  })

  const monitorConnected = Effect.fnUntraced(function* (live: RpcSession.RpcSession) {
    for (;;) {
      const next = yield* takeConnectedSignal
      if (next._tag === "DisconnectRequested") return
      const timeout = probeTimeoutFor(next)
      if (timeout === undefined) continue
      if ((yield* awaitProbe(live, timeout)) === "end") return
    }
  })

  const runAttempt = Effect.fnUntraced(function* (
    attempt: number,
    generation: number,
    lastFailure: ConnectionAttemptError | null,
  ) {
    yield* SubscriptionRef.set(prepared, Option.none())
    const synchronizing = yield* Ref.make(false)
    const establishment = yield* Effect.raceAllFirst([
      exitUnlessInterrupted(establish(attempt, generation, lastFailure, synchronizing)).pipe(
        Effect.map((exit): EstablishmentEvent => ({ _tag: "Completed", exit })),
      ),
      waitForEstablishmentInterrupt().pipe(Effect.as<EstablishmentEvent>({ _tag: "Interrupted" })),
      establishmentDeadline(synchronizing).pipe(Effect.as<EstablishmentEvent>({ _tag: "TimedOut" })),
    ])
    if (establishment._tag === "Interrupted")
      return { _tag: "Interrupted", established: false, stable: false } satisfies AttemptOutcome
    if (establishment._tag === "TimedOut")
      return {
        _tag: "Failure",
        established: false,
        stable: false,
        unansweredProbe: false,
        error: new ConnectionTransientError({
          reason: "timeout",
          detail: "Kiko did not respond during connection setup.",
        }),
      } satisfies AttemptOutcome
    if (Exit.isFailure(establishment.exit)) return failureFromExit(establishment.exit, false, false)

    const live = establishment.exit.value
    const currentIntent = yield* Ref.get(intent)
    if (!currentIntent.desired || currentIntent.network === "offline")
      return { _tag: "Interrupted", established: false, stable: false } satisfies AttemptOutcome

    const connectedAt = yield* Clock.currentTimeMillis
    yield* SubscriptionRef.set(session, Option.some(live))
    yield* setState({ ...baseState(currentIntent, "connected", generation, attempt, null), desired: true })
    const connectedExit = yield* exitUnlessInterrupted(Effect.raceFirst(live.closed, monitorConnected(live)))
    const stable = (yield* Clock.currentTimeMillis) - connectedAt >= BACKOFF_RESET_AFTER_MS
    const outcome = failureFromExit(connectedExit, true, stable)
    return outcome._tag === "Failure" && probeTimedOut(outcome.error) ? { ...outcome, unansweredProbe: true } : outcome
  }, Effect.ensuring(clearLease))

  const waitForRetrySignal = (delayMs: number) =>
    Effect.raceFirst(
      Effect.sleep(delayMs).pipe(Effect.as(false)),
      Queue.take(signals).pipe(Effect.map((next) => next._tag === "Wakeup")),
    )

  const waitForSignal = Queue.take(signals).pipe(Effect.map((next) => next._tag === "Wakeup"))

  const ladder = { failureCount: 0, generation: 0, latestFailure: null as ConnectionAttemptError | null }

  const idle = Effect.fnUntraced(function* (currentIntent: SupervisorIntent) {
    yield* clearLease
    if (!currentIntent.desired) {
      ladder.failureCount = 0
      ladder.latestFailure = null
      yield* setState(baseState(currentIntent, "available", ladder.generation, 0, null))
      yield* waitForSignal
      return
    }
    yield* setState(
      baseState(currentIntent, "offline", ladder.generation, ladder.failureCount + 1, ladder.latestFailure),
    )
    if (yield* waitForSignal) ladder.failureCount = 0
  })

  const afterFailure = Effect.fnUntraced(function* (
    attempt: number,
    error: ConnectionAttemptError,
    unansweredProbe: boolean,
  ) {
    const failedIntent = yield* Ref.get(intent)
    if (error._tag === "ConnectionBlockedError") {
      yield* setState(baseState(failedIntent, "blocked", ladder.generation, attempt, error))
      if (yield* waitForSignal) ladder.failureCount = 0
      return
    }
    if (unansweredProbe) {
      ladder.failureCount = 0
      yield* setState(connectingState(failedIntent, ladder.generation, 1, ladder.latestFailure))
      return
    }
    ladder.failureCount += 1
    const delayMs = retryDelayMs(ladder.failureCount - 1, yield* Random.next)
    yield* setState({
      ...baseState(failedIntent, "backoff", ladder.generation, attempt, ladder.latestFailure),
      retryAt: (yield* Clock.currentTimeMillis) + delayMs,
    })
    if (yield* waitForRetrySignal(delayMs)) ladder.failureCount = 0
  })

  const run = Effect.fnUntraced(function* () {
    for (;;) {
      if (yield* Ref.getAndSet(resetRetryState, false)) {
        ladder.failureCount = 0
        ladder.latestFailure = null
      }
      const currentIntent = yield* Ref.get(intent)
      if (!currentIntent.desired || currentIntent.network === "offline") {
        yield* idle(currentIntent)
        continue
      }
      const attempt = ladder.failureCount + 1
      const nextGeneration = ladder.generation + 1
      const outcome: AttemptOutcome = yield* Effect.scoped(runAttempt(attempt, nextGeneration, ladder.latestFailure))
      if (outcome.established) {
        ladder.generation = nextGeneration
        ladder.latestFailure = null
        if (outcome.stable) ladder.failureCount = 0
      }
      if (outcome._tag === "Interrupted") continue
      if (!outcome.established) ladder.latestFailure = outcome.error
      yield* afterFailure(attempt, outcome.error, outcome.unansweredProbe)
    }
  })

  yield* connectivity.changes.pipe(
    Stream.runForEach((network) =>
      Ref.modify(intent, (current) =>
        current.network === network ? [false, current] : ([true, { ...current, network }] as const),
      ).pipe(Effect.flatMap((changed) => (changed ? signal({ _tag: "NetworkChanged", network }) : Effect.void))),
    ),
    Effect.forkScoped,
  )
  yield* wakeups.changes.pipe(
    Stream.runForEach((reason) => signal({ _tag: "Wakeup", reason })),
    Effect.forkScoped,
  )
  yield* run().pipe(Effect.forkScoped)

  const connect = Ref.update(intent, (current) => ({ ...current, desired: true })).pipe(
    Effect.andThen(signal({ _tag: "ConnectRequested" })),
  )
  const disconnect = Ref.update(intent, (current) => ({ ...current, desired: false })).pipe(
    Effect.andThen(signal({ _tag: "DisconnectRequested" })),
  )
  const retryNow = Ref.set(resetRetryState, true).pipe(Effect.andThen(signal({ _tag: "RetryRequested" })))

  yield* Effect.addFinalizer(() => Queue.shutdown(signals).pipe(Effect.andThen(clearLease)))

  return OwnerSupervisor.of({ state, session, prepared, connect, disconnect, retryNow })
})

export const layer = (options?: OwnerSupervisorOptions) => Layer.effect(OwnerSupervisor, make(options))
