import type { UserSignal } from "@kiko/protocol"
import { describe, expect, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as PubSub from "effect/PubSub"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { OwnerSupervisor } from "../connection/supervisor"
import { layer as cacheLayer, layerMemoryStore, SnapshotCache } from "../platform/cache"
import type { PreparedConnection, SupervisorConnectionState } from "../connection/model"
import type { OwnerRpcClient } from "../rpc/protocol"
import type { RpcSession } from "../rpc/session"
import { createQueryAtoms } from "./query"
import type { OwnerRuntimeServices } from "./runtime"
import { UserStore, type UserState } from "./userState"
import { emptyStreamState } from "./stream"

const session: RpcSession = {
  client: (() => Effect.die("unused")) as unknown as OwnerRpcClient,
  ready: Effect.void,
  probe: Effect.void,
  closed: Effect.never,
}

const setup = Effect.fnUntraced(function* () {
  const sessions = yield* SubscriptionRef.make(Option.none<RpcSession>())
  const signals = yield* PubSub.unbounded<UserSignal>()
  const supervisor = OwnerSupervisor.of({
    state: yield* SubscriptionRef.make({} as SupervisorConnectionState),
    session: sessions,
    prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  })
  const user = UserStore.of({
    state: yield* SubscriptionRef.make<UserState>({ ...emptyStreamState(), build: {} }),
    signals,
    disconnected: Effect.void,
  })
  const cache = yield* SnapshotCache.pipe(Effect.provide(cacheLayer.pipe(Layer.provide(layerMemoryStore))))
  const runtime = Atom.runtime(
    Layer.mergeAll(
      Layer.succeed(OwnerSupervisor, supervisor),
      Layer.succeed(UserStore, user),
      Layer.succeed(SnapshotCache, cache),
    ),
  ) as unknown as Atom.AtomRuntime<OwnerRuntimeServices, never>
  return { sessions, signals, runtime, cache }
})

const yieldTimes = (n: number) => Effect.repeat(Effect.yieldNow, { times: n })

describe("query atoms", () => {
  it.effect("wait for a session, then run once per input", () =>
    Effect.gen(function* () {
      const { sessions, runtime } = yield* setup()
      const { query } = createQueryAtoms(runtime)
      const runs: string[] = []
      const soul = query({
        label: "soul",
        execute: (input: { slug: string }) => Effect.sync(() => (runs.push(input.slug), `soul of ${input.slug}`)),
      })
      const registry = AtomRegistry.make()
      const atom = soul({ slug: "scout" })
      const unmount = registry.mount(atom)
      yield* yieldTimes(20)
      expect(registry.get(atom)._tag).toBe("Initial")
      expect(runs).toEqual([])

      yield* SubscriptionRef.set(sessions, Option.some(session))
      const result = yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })
      expect(result).toBe("soul of scout")
      expect(soul({ slug: "scout" })).toBe(atom)
      expect(runs).toEqual(["scout"])
      unmount()
    }),
  )

  it.effect("paint the last stored result before the socket connects, then replace and store the fresh one", () =>
    Effect.gen(function* () {
      const { sessions, runtime, cache } = yield* setup()
      const { query } = createQueryAtoms(runtime)
      yield* cache.saveQuery("catalog:null", Schema.String, "yesterday's catalog")
      const catalog = query({
        label: "catalog",
        execute: () => Effect.succeed("today's catalog"),
        cached: Schema.String,
      })
      const registry = AtomRegistry.make()
      const atom = catalog(undefined)
      const unmount = registry.mount(atom)
      yield* yieldTimes(20)
      const early = registry.get(atom)
      expect(Option.getOrUndefined(AsyncResult.value(early))).toBe("yesterday's catalog")
      expect(early.waiting).toBe(true)

      yield* SubscriptionRef.set(sessions, Option.some(session))
      expect(yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })).toBe("today's catalog")
      expect(yield* cache.loadQuery("catalog:null", Schema.String)).toEqual(Option.some("today's catalog"))
      unmount()
    }),
  )

  it.effect("run again when the user stream says its data changed", () =>
    Effect.gen(function* () {
      const { sessions, signals, runtime } = yield* setup()
      yield* SubscriptionRef.set(sessions, Option.some(session))
      const { query } = createQueryAtoms(runtime)
      let reads = 0
      const reread = yield* Deferred.make<void>()
      const memory = query({
        label: "memory",
        refreshOn: "memory",
        execute: () =>
          Effect.sync(() => ++reads).pipe(
            Effect.tap((n) => (n > 1 ? Deferred.succeed(reread, undefined) : Effect.void)),
          ),
      })
      const registry = AtomRegistry.make()
      const atom = memory(undefined)
      const unmount = registry.mount(atom)
      expect(yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })).toBe(1)

      yield* PubSub.publish(signals, { t: "changed", what: "models" })
      yield* yieldTimes(20)
      expect(reads).toBe(1)
      yield* PubSub.publish(signals, { t: "changed", what: "memory" })
      yield* Deferred.await(reread)
      expect(yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })).toBe(2)
      expect(reads).toBe(2)
      unmount()
    }),
  )
})

describe("query edits", () => {
  const settingsQuery = Effect.fnUntraced(function* () {
    const { sessions, runtime } = yield* setup()
    yield* SubscriptionRef.set(sessions, Option.some(session))
    const { query } = createQueryAtoms(runtime)
    const server = { value: "digest" }
    const settings = query({ label: "settings", execute: () => Effect.sync(() => server.value) })
    const registry = AtomRegistry.make()
    const atom = settings(undefined)
    const seen: string[] = []
    const unmount = registry.subscribe(
      atom,
      (result) => {
        const value = Option.getOrUndefined(AsyncResult.value(result))
        if (value !== undefined && seen.at(-1) !== value) seen.push(value)
      },
      { immediate: true },
    )
    expect(yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })).toBe("digest")
    const saving = (value: string, ack: Deferred.Deferred<void>) =>
      settings
        .edit(
          undefined,
          () => value,
          Deferred.await(ack).pipe(Effect.tap(() => Effect.sync(() => (server.value = value)))),
        )
        .pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry))
    return { server, registry, atom, seen, unmount, saving, settings }
  })

  it.effect("show each pick at once and never fall back to an older value while saves and rereads overlap", () =>
    Effect.gen(function* () {
      const { server, registry, atom, seen, unmount, saving } = yield* settingsQuery()
      const firstAck = yield* Deferred.make<void>()
      const secondAck = yield* Deferred.make<void>()
      const first = yield* Effect.forkChild(saving("chat", firstAck))
      yield* yieldTimes(5)
      const second = yield* Effect.forkChild(saving("off", secondAck))
      yield* yieldTimes(5)
      expect(seen).toEqual(["digest", "chat", "off"])

      yield* Deferred.succeed(firstAck, undefined)
      yield* Fiber.join(first)
      yield* yieldTimes(20)
      expect(seen).toEqual(["digest", "chat", "off"])

      yield* Deferred.succeed(secondAck, undefined)
      yield* Fiber.join(second)
      yield* yieldTimes(20)
      expect(seen).toEqual(["digest", "chat", "off"])

      server.value = "active"
      registry.refresh(atom)
      expect(yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })).toBe("active")
      unmount()
    }),
  )

  it.effect("put a refused pick back at once", () =>
    Effect.gen(function* () {
      const { registry, atom, seen, unmount, settings } = yield* settingsQuery()
      const ack = yield* Deferred.make<void>()
      const refused = yield* Effect.forkChild(
        settings
          .edit(undefined, () => "off", Deferred.await(ack).pipe(Effect.andThen(Effect.fail("refused"))))
          .pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry), Effect.flip),
      )
      yield* yieldTimes(5)
      expect(Option.getOrUndefined(AsyncResult.value(registry.get(atom)))).toBe("off")
      yield* Deferred.succeed(ack, undefined)
      expect(yield* Fiber.join(refused)).toBe("refused")
      expect(seen).toEqual(["digest", "off", "digest"])
      unmount()
    }),
  )
})
