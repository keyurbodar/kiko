import type { UserSignal } from "@kiko/protocol"
import { describe, expect, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as PubSub from "effect/PubSub"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { OwnerSupervisor } from "../connection/supervisor"
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
  const runtime = Atom.runtime(
    Layer.mergeAll(Layer.succeed(OwnerSupervisor, supervisor), Layer.succeed(UserStore, user)),
  ) as unknown as Atom.AtomRuntime<OwnerRuntimeServices, never>
  return { sessions, signals, runtime }
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
