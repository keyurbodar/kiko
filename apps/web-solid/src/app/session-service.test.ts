import { describe, expect, it } from "@effect/vitest"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as TestClock from "effect/testing/TestClock"
import { readyOf, type AuthRecord } from "./auth-record"
import { start, type Boot, type ClerkUser, type Exchange } from "./machine"
import type { BackendKey, BackendUrl, ClerkUserId, Descriptor, Phase, SessionToken } from "./phase"
import { BackendClient, Clerk, ClerkUnavailable, Device, Installer, Session } from "./session-service"

const alice: ClerkUser = { id: "user_alice" as ClerkUserId, email: "alice@example.com" }
const bob: ClerkUser = { id: "user_bob" as ClerkUserId, email: "bob@example.com" }
const URL_A = "https://kiko.alice.workers.dev" as BackendUrl
const keyOf = (id: string | null, url: string) => `${id}|${url}` as BackendKey
const backend = { url: URL_A, key: keyOf(alice.id, URL_A) }
const identity = { clerkUserId: alice.id, email: alice.email }
const token = "owner.session.1.mac" as SessionToken
const user = { id: "owner", name: "owner" }
const record: AuthRecord = { v: 1, identity, backend, user, token }
const CURRENT: Descriptor = { _tag: "Current", version: "1.0.0", protocol: 3, selfUpdate: true }
const ok = (value = "owner.session.2.mac"): Exchange => ({ _tag: "Ok", user, token: value as SessionToken })

interface Options {
  readonly clerkUser?: ClerkUser | null
  readonly pointer?: BackendUrl | null
  readonly clerkSignOut?: "works" | "fails"
  readonly describe?: (count: number) => Effect.Effect<Descriptor>
  readonly exchange?: (fresh: boolean) => Effect.Effect<Exchange>
}

const harness = Effect.fnUntraced(function* (options: Options = {}) {
  const log = yield* Ref.make<ReadonlyArray<string>>([])
  const note = (entry: string) => Ref.update(log, (all) => [...all, entry])
  const clerkUser = yield* Ref.make(options.clerkUser === undefined ? alice : options.clerkUser)
  const changes = yield* Queue.unbounded<ClerkUser | null>()
  const described = yield* Ref.make(0)
  const left = yield* Deferred.make<void>()
  let lastFresh = false
  const layer = Layer.mergeAll(
    Layer.succeed(Clerk, {
      user: Ref.get(clerkUser),
      changes: Stream.fromQueue(changes),
      pointer: note("user.reload").pipe(
        Effect.andThen(Ref.get(clerkUser)),
        Effect.map((signedIn) => (signedIn && options.pointer !== null ? (options.pointer ?? URL_A) : null)),
      ),
      token: (fresh) =>
        note(fresh ? "token:fresh" : "token:cached").pipe(
          Effect.andThen(Effect.sync(() => (lastFresh = fresh))),
          Effect.as(fresh ? "fresh-jwt" : "cached-jwt"),
        ),
      signOut: note("clerk.signOut").pipe(
        Effect.andThen(Ref.set(clerkUser, null)),
        Effect.andThen(
          options.clerkSignOut === "fails" ? Effect.fail(new ClerkUnavailable({ message: "offline" })) : Effect.void,
        ),
      ),
    }),
    Layer.succeed(BackendClient, {
      describe: () =>
        Ref.updateAndGet(described, (n) => n + 1).pipe(
          Effect.tap(() => note("describe")),
          Effect.flatMap((count) => options.describe?.(count) ?? Effect.succeed(CURRENT)),
        ),
      exchange: (_url, clerkToken) =>
        note(`exchange:${clerkToken}`).pipe(Effect.andThen(options.exchange?.(lastFresh) ?? Effect.succeed(ok()))),
      key: (id, url) => Effect.succeed(keyOf(id, url)),
    }),
    Layer.succeed(Device, {
      save: (saved) => note(`save:${saved.token}`),
      clearAuth: note("clear-auth"),
      signingOut: (on) => note(on ? "flag:on" : "flag:off"),
      release: note("release"),
      purge: note("purge"),
      leave: note("leave").pipe(Effect.andThen(Deferred.succeed(left, undefined))),
      reload: note("reload"),
    }),
    Layer.succeed(Installer, { detach: (clerkToken) => note(`detach:${clerkToken}`) }),
  )
  return { log, layer, changes, clerkUser, described, left }
})

const boot = (layer: Layer.Layer<Clerk | BackendClient | Device | Installer>, phase: Phase | Boot) =>
  Layer.build(Session.layer("_tag" in phase ? { phase, command: null } : start(phase)).pipe(Layer.provide(layer))).pipe(
    Effect.map(Context.get(Session)),
  )

const until = (session: Session["Service"], predicate: (phase: Phase) => boolean) =>
  SubscriptionRef.changes(session.phase).pipe(Stream.filter(predicate), Stream.runHead, Effect.map(Option.getOrThrow))

const reach = (session: Session["Service"], tag: Phase["_tag"]) => until(session, (phase) => phase._tag === tag)

const fresh = { record: null, signingOut: false, hosted: true, callback: false }

describe("signing out", () => {
  it.effect("closes the runtime, drops kiko:auth, signs out of Clerk, purges, then leaves", () =>
    Effect.gen(function* () {
      const { log, layer } = yield* harness()
      const session = yield* boot(layer, readyOf(record))
      yield* session.send({ _tag: "SignOut" })
      expect(yield* Ref.get(log)).toEqual([
        "flag:on",
        "release",
        "clear-auth",
        "clerk.signOut",
        "purge",
        "flag:off",
        "leave",
      ])
    }),
  )

  it.effect("keeps the flag when Clerk will not sign out, and never resumes that session", () =>
    Effect.gen(function* () {
      const failing = yield* harness({ clerkSignOut: "fails" })
      const first = yield* boot(failing.layer, readyOf(record))
      yield* first.send({ _tag: "SignOut" })
      expect(yield* Ref.get(failing.log)).toEqual([
        "flag:on",
        "release",
        "clear-auth",
        "clerk.signOut",
        "purge",
        "leave",
      ])

      const after = yield* harness({ clerkSignOut: "fails" })
      const reloaded = yield* boot(after.layer, { ...fresh, signingOut: true })
      expect(yield* reach(reloaded, "SignedOut")).toEqual({
        _tag: "SignedOut",
        clerk: { _tag: "Live", email: alice.email },
      })
      expect(yield* Ref.get(after.log)).toEqual(["purge", "clerk.signOut"])
    }),
  )

  it.effect("clears the flag once Clerk signs out on the next boot", () =>
    Effect.gen(function* () {
      const { log, layer } = yield* harness()
      const session = yield* boot(layer, { ...fresh, signingOut: true })
      expect(yield* reach(session, "SignedOut")).toEqual({ _tag: "SignedOut", clerk: { _tag: "None" } })
      expect(yield* Ref.get(log)).toEqual(["purge", "clerk.signOut", "flag:off"])
    }),
  )

  it.effect("drops an exchange that was still running when the owner signed out", () =>
    Effect.gen(function* () {
      const asked = yield* Deferred.make<void>()
      const answer = yield* Deferred.make<Exchange>()
      const { log, layer } = yield* harness({
        exchange: () => Deferred.succeed(asked, undefined).pipe(Effect.andThen(Deferred.await(answer))),
      })
      const session = yield* boot(layer, fresh)
      yield* Deferred.await(asked)
      yield* session.send({ _tag: "SignOut" })
      yield* Deferred.succeed(answer, ok())
      expect(yield* Ref.get(log)).not.toContain("save:owner.session.2.mac")
      expect(yield* SubscriptionRef.get(session.phase)).toEqual({ _tag: "SigningOut" })
    }),
  )
})

describe("signing in", () => {
  it.effect("resolves the Clerk session to the backend its pointer names and saves the record", () =>
    Effect.gen(function* () {
      const { log, layer } = yield* harness()
      const session = yield* boot(layer, fresh)
      const ready = yield* reach(session, "Ready")
      expect(ready).toEqual(readyOf({ ...record, token: "owner.session.2.mac" as SessionToken }))
      expect(yield* Ref.get(log)).toEqual([
        "flag:off",
        "user.reload",
        "describe",
        "token:cached",
        "exchange:cached-jwt",
        "save:owner.session.2.mac",
      ])
    }),
  )

  it.effect("retries an expired Clerk token once with skipCache", () =>
    Effect.gen(function* () {
      const { log, layer } = yield* harness({
        exchange: (wasFresh) => Effect.succeed(wasFresh ? ok() : { _tag: "Expired" }),
      })
      const session = yield* boot(layer, fresh)
      yield* reach(session, "Ready")
      expect((yield* Ref.get(log)).filter((entry) => entry.startsWith("token"))).toEqual([
        "token:cached",
        "token:fresh",
      ])
    }),
  )

  it.effect("resolves a session the mounted sign-in form creates", () =>
    Effect.gen(function* () {
      const { layer, changes, clerkUser } = yield* harness({ clerkUser: null })
      const session = yield* boot(layer, fresh)
      yield* reach(session, "SignedOut")
      yield* Ref.set(clerkUser, alice)
      yield* Queue.offer(changes, alice)
      expect(yield* reach(session, "Ready")).toMatchObject({ identity })
    }),
  )

  it.effect("probes an unreachable backend with backoff and signs in once it answers", () =>
    Effect.gen(function* () {
      const { layer, described } = yield* harness({
        describe: (count) => Effect.succeed(count < 4 ? { _tag: "Unreachable" } : CURRENT),
      })
      const session = yield* boot(layer, fresh)
      yield* reach(session, "Unreachable")
      expect(yield* Ref.get(described)).toBe(1)
      yield* TestClock.adjust("1999 millis")
      expect(yield* Ref.get(described)).toBe(1)
      yield* TestClock.adjust("1 millis")
      expect(yield* Ref.get(described)).toBe(2)
      yield* TestClock.adjust("2 seconds")
      expect(yield* Ref.get(described)).toBe(3)
      yield* TestClock.adjust("2 seconds")
      expect(yield* reach(session, "Ready")).toMatchObject({ _tag: "Ready", backend })
    }),
  )

  it.effect("stops probing when the owner reconnects Cloudflare instead", () =>
    Effect.gen(function* () {
      const { layer, described } = yield* harness({ describe: () => Effect.succeed({ _tag: "Unreachable" }) })
      const session = yield* boot(layer, fresh)
      yield* reach(session, "Unreachable")
      yield* session.send({ _tag: "ConnectCloudflare" })
      yield* TestClock.adjust("1 minute")
      expect(yield* Ref.get(described)).toBe(1)
      expect((yield* SubscriptionRef.get(session.phase))._tag).toBe("Installing")
    }),
  )
})

describe("a stored sign-in", () => {
  it.effect("purges and starts over when Clerk has another user", () =>
    Effect.gen(function* () {
      const { log, layer, left } = yield* harness({ clerkUser: bob })
      const session = yield* boot(layer, { ...fresh, record })
      yield* Deferred.await(left)
      expect(yield* SubscriptionRef.get(session.phase)).toEqual({ _tag: "SigningOut" })
      expect(yield* Ref.get(log)).toEqual(["release", "clear-auth", "purge", "leave"])
    }),
  )

  it.effect("reloads when another tab signs out, and adopts a token another tab renewed", () =>
    Effect.gen(function* () {
      const { log, layer } = yield* harness()
      const session = yield* boot(layer, readyOf(record))
      const renewed = { ...record, token: "owner.session.3.mac" as SessionToken }
      yield* session.send({ _tag: "Stored", record: renewed })
      expect(yield* SubscriptionRef.get(session.phase)).toEqual(readyOf(renewed))
      yield* session.send({ _tag: "Stored", record: null })
      expect(yield* Ref.get(log)).toEqual(["reload"])
    }),
  )

  it.effect("renews a refused session with a fresh Clerk token", () =>
    Effect.gen(function* () {
      const { log, layer } = yield* harness()
      const session = yield* boot(layer, readyOf(record))
      yield* session.send({ _tag: "Rejected" })
      yield* until(session, (phase) => phase._tag === "Ready" && phase.token !== token)
      expect(yield* Ref.get(log)).toEqual(["token:fresh", "exchange:fresh-jwt", "save:owner.session.2.mac"])
    }),
  )

  it.effect("forgets the backend through the installer, then purges", () =>
    Effect.gen(function* () {
      const { log, layer } = yield* harness()
      const session = yield* boot(layer, readyOf(record))
      yield* session.forget
      expect(yield* SubscriptionRef.get(session.phase)).toEqual({
        _tag: "NeedsBackend",
        identity,
        reason: "detached",
        previous: backend,
      })
      expect(yield* Ref.get(log)).toEqual(["token:fresh", "detach:fresh-jwt", "release", "clear-auth", "purge"])
    }),
  )

  it.effect("goes back to sign-in when Clerk no longer has the user an install finished for", () =>
    Effect.gen(function* () {
      const { log, layer } = yield* harness({ clerkUser: null })
      const session = yield* boot(layer, { _tag: "NeedsBackend", identity, reason: "none", previous: null })
      yield* session.send({ _tag: "Installed" })
      yield* session.settled
      expect(yield* SubscriptionRef.get(session.phase)).toEqual({ _tag: "SignedOut", clerk: { _tag: "None" } })
      expect(yield* Ref.get(log)).not.toContain("user.reload")
    }),
  )

  it.effect("settles on the new backend after an install", () =>
    Effect.gen(function* () {
      const { layer } = yield* harness()
      const session = yield* boot(layer, { _tag: "NeedsBackend", identity, reason: "none", previous: null })
      yield* session.send({ _tag: "Installed" })
      yield* session.settled
      expect((yield* SubscriptionRef.get(session.phase))._tag).toBe("Ready")
    }),
  )
})
