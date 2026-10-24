import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FiberHandle from "effect/FiberHandle"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Schedule from "effect/Schedule"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import type { AuthRecord } from "./auth-record"
import {
  type Attempt,
  type ClerkUser,
  type Command,
  type Event,
  type Exchange,
  isAttempt,
  type Step,
  type Task,
  transition,
} from "./machine"
import type { Backend, BackendKey, BackendUrl, ClerkUserId, Descriptor, Identity, Phase } from "./phase"

export class ClerkUnavailable extends Schema.TaggedError<ClerkUnavailable>()("ClerkUnavailable", {
  message: Schema.String,
}) {}

export class DetachFailed extends Schema.TaggedError<DetachFailed>()("DetachFailed", {
  message: Schema.String,
}) {}

export class Clerk extends Context.Service<
  Clerk,
  {
    readonly user: Effect.Effect<ClerkUser | null, ClerkUnavailable>
    readonly changes: Stream.Stream<ClerkUser | null>
    readonly pointer: Effect.Effect<BackendUrl | null, ClerkUnavailable>
    readonly token: (fresh: boolean) => Effect.Effect<string | null, ClerkUnavailable>
    readonly signOut: Effect.Effect<void, ClerkUnavailable>
  }
>()("kiko/session/Clerk") {}

export class BackendClient extends Context.Service<
  BackendClient,
  {
    readonly describe: (url: BackendUrl) => Effect.Effect<Descriptor>
    readonly exchange: (url: BackendUrl, clerkToken: string) => Effect.Effect<Exchange>
    readonly key: (clerkUserId: ClerkUserId | null, url: BackendUrl) => Effect.Effect<BackendKey>
  }
>()("kiko/session/BackendClient") {}

export class Device extends Context.Service<
  Device,
  {
    readonly save: (record: AuthRecord) => Effect.Effect<void>
    readonly clearAuth: Effect.Effect<void>
    readonly signingOut: (on: boolean) => Effect.Effect<void>
    readonly release: Effect.Effect<void>
    readonly purge: Effect.Effect<void>
    readonly leave: Effect.Effect<void>
    readonly reload: Effect.Effect<void>
  }
>()("kiko/session/Device") {}

export class Installer extends Context.Service<
  Installer,
  { readonly detach: (clerkToken: string) => Effect.Effect<void, DetachFailed> }
>()("kiko/session/Installer") {}

interface Letter {
  readonly event: Event
  readonly handled: Deferred.Deferred<void> | null
}

const PROBE_MIN_MS = 2_000
const PROBE_MAX_MS = 30_000
const BACKOFF = Schedule.min([Schedule.exponential("2 seconds"), Schedule.spaced("30 seconds")])

const settledPhase = (phase: Phase) => phase._tag !== "Booting" && phase._tag !== "Resolving"

const make = Effect.fnUntraced(function* (initial: Step) {
  const clerk = yield* Clerk
  const backends = yield* BackendClient
  const device = yield* Device
  const installer = yield* Installer
  const phase = yield* SubscriptionRef.make(initial.phase)
  const inbox = yield* Queue.unbounded<Letter>()
  const attempts = yield* FiberHandle.make<void, never>()

  const post = (event: Event) => Queue.offer(inbox, { event, handled: null }).pipe(Effect.asVoid)

  const pointed = Effect.fnUntraced(function* (identity: Identity) {
    const url = yield* clerk.pointer
    const backend = url === null ? null : { url, key: yield* backends.key(identity.clerkUserId, url) }
    yield* post({ _tag: "Pointed", backend })
  })

  const verify = Effect.fnUntraced(function* (identity: Identity) {
    const user = yield* clerk.user
    if (user?.id !== identity.clerkUserId) return yield* post({ _tag: "Clerk", user, callback: false })
    yield* pointed(identity)
  })

  const exchange = Effect.fnUntraced(function* (backend: Backend, fresh: boolean) {
    const clerkToken = yield* clerk.token(fresh)
    if (clerkToken === null) return yield* post({ _tag: "Clerk", user: null, callback: false })
    const result = yield* backends.exchange(backend.url, clerkToken)
    yield* post({ _tag: "Exchanged", backend, fresh, result })
  })

  const probe = Effect.fnUntraced(function* (backend: Backend, since: number) {
    for (;;) {
      const elapsed = (yield* Clock.currentTimeMillis) - since
      yield* Effect.sleep(Duration.millis(Math.min(PROBE_MAX_MS, Math.max(PROBE_MIN_MS, elapsed / 2))))
      if ((yield* backends.describe(backend.url))._tag !== "Unreachable") return yield* post({ _tag: "Retry" })
    }
  })

  const attempt = (command: Attempt): Effect.Effect<void> => {
    switch (command._tag) {
      case "CheckClerk":
        return clerk.user.pipe(
          Effect.matchEffect({
            onFailure: () => post({ _tag: "ClerkFailed" }),
            onSuccess: (user) => post({ _tag: "Clerk", user, callback: command.callback }),
          }),
        )
      case "Verify":
        return verify(command.identity).pipe(Effect.ignore)
      case "Point":
        return device
          .signingOut(false)
          .pipe(Effect.andThen(verify(command.identity).pipe(Effect.retry(BACKOFF), Effect.ignore)))
      case "Describe":
        return backends
          .describe(command.backend.url)
          .pipe(Effect.flatMap((descriptor) => post({ _tag: "Described", backend: command.backend, descriptor })))
      case "Exchange":
        return exchange(command.backend, command.fresh).pipe(
          Effect.catch(() =>
            post({
              _tag: "Exchanged",
              backend: command.backend,
              fresh: command.fresh,
              result: { _tag: "Unreachable" },
            }),
          ),
        )
      case "Probe":
        return probe(command.backend, command.since)
    }
  }

  const signOut = Effect.gen(function* () {
    yield* device.signingOut(true)
    yield* device.release
    yield* device.clearAuth
    const signedOut = yield* clerk.signOut.pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    )
    yield* device.purge
    if (signedOut) yield* device.signingOut(false)
    yield* device.leave
  })

  const finishSignOut = Effect.gen(function* () {
    yield* device.purge
    const user = yield* Effect.option(clerk.user)
    if (Option.isNone(user)) return yield* post({ _tag: "ClerkFailed" })
    const signedOut = yield* clerk.signOut.pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    )
    if (signedOut) yield* device.signingOut(false)
    yield* post({ _tag: "ClerkSignedOut", user: signedOut ? null : user.value })
  })

  const forgetLocally = device.release.pipe(Effect.andThen(device.clearAuth), Effect.andThen(device.purge))

  const task = (command: Task): Effect.Effect<void> => {
    switch (command._tag) {
      case "Save":
        return device.save(command.record)
      case "Purge":
        return forgetLocally
      case "SignOut":
        return signOut
      case "FinishSignOut":
        return finishSignOut
      case "Reset":
        return forgetLocally.pipe(Effect.andThen(device.leave))
      case "Reload":
        return device.reload
    }
  }

  const run = (command: Command) =>
    isAttempt(command) ? FiberHandle.run(attempts, attempt(command)).pipe(Effect.asVoid) : task(command)

  const handle = Effect.fnUntraced(function* (letter: Letter) {
    const before = yield* SubscriptionRef.get(phase)
    const { phase: next, command } = transition(before, letter.event, yield* Clock.currentTimeMillis)
    if (command?._tag === "Save") yield* device.save(command.record)
    if (next !== before) yield* SubscriptionRef.set(phase, next)
    if (next._tag !== before._tag) yield* FiberHandle.clear(attempts)
    if (command && command._tag !== "Save") yield* run(command)
  })

  const deliver = (letter: Letter) =>
    handle(letter).pipe(
      Effect.catchCause((cause) => Effect.logError("Kiko could not handle a sign-in event.", cause)),
      Effect.ensuring(letter.handled ? Deferred.succeed(letter.handled, undefined) : Effect.void),
    )

  yield* clerk.changes.pipe(
    Stream.runForEach((user) => post({ _tag: "Clerk", user, callback: false })),
    Effect.forkScoped,
  )
  yield* Effect.gen(function* () {
    if (initial.command) yield* run(initial.command)
    yield* Effect.forever(Queue.take(inbox).pipe(Effect.flatMap(deliver)))
  }).pipe(Effect.forkScoped)

  const send = Effect.fnUntraced(function* (event: Event) {
    const handled = yield* Deferred.make<void>()
    yield* Queue.offer(inbox, { event, handled })
    yield* Deferred.await(handled)
  })

  const settled = SubscriptionRef.changes(phase).pipe(Stream.filter(settledPhase), Stream.runHead, Effect.asVoid)

  const forget = Effect.gen(function* () {
    const clerkToken = yield* clerk.token(true)
    if (clerkToken === null) return yield* new DetachFailed({ message: "Sign in again, then try again." })
    yield* installer.detach(clerkToken)
    yield* send({ _tag: "Detached" })
  })

  return { phase, send, settled, forget }
})

export class Session extends Context.Service<Session, Effect.Success<ReturnType<typeof make>>>()(
  "kiko/session/Session",
) {
  static readonly layer = (initial: Step) => Layer.effect(Session, make(initial))
}
