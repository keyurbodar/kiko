import type { ComputerFrame } from "@kiko/protocol"
import { describe, expect, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { OwnerSupervisor } from "../connection/supervisor"
import type { PreparedConnection, SupervisorConnectionState } from "../connection/model"
import type { OwnerRpcClient } from "../rpc/protocol"
import type { RpcSession } from "../rpc/session"
import { createComputerAtoms } from "./computer"
import type { OwnerRuntimeServices } from "./runtime"

const PC = "pc-1"

const frame = (seq: number): ComputerFrame => ({
  seq,
  mime: "image/jpeg",
  width: 64,
  height: 48,
  cursor: null,
  data: "ZnJhbWU=",
})

const setup = Effect.fnUntraced(function* () {
  const calls: string[] = []
  const interrupts: string[] = []
  const frames = yield* Queue.unbounded<ComputerFrame>()
  const seen = yield* Deferred.make<void>()
  const client = ((tag: string) => {
    calls.push(tag)
    return Stream.fromQueue(frames).pipe(
      Stream.tap(() => Deferred.succeed(seen, undefined)),
      Stream.ensuring(Effect.sync(() => interrupts.push(tag))),
    )
  }) as unknown as OwnerRpcClient
  const session: RpcSession = { client, ready: Effect.void, probe: Effect.void, closed: Effect.never }
  const supervisor = OwnerSupervisor.of({
    state: yield* SubscriptionRef.make({} as SupervisorConnectionState),
    session: yield* SubscriptionRef.make(Option.some(session)),
    prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  })
  const runtime = Atom.runtime(Layer.succeed(OwnerSupervisor, supervisor)) as unknown as Atom.AtomRuntime<
    OwnerRuntimeServices,
    never
  >
  return { runtime, calls, interrupts, frames, seen }
})

const yieldTimes = (n: number) => Effect.repeat(Effect.yieldNow, { times: n })

const latest = (registry: AtomRegistry.AtomRegistry, atom: Atom.Atom<unknown>) => {
  const result = registry.get(atom) as { _tag: string; value?: Option.Option<ComputerFrame> }
  return result._tag === "Success" ? Option.getOrUndefined(result.value ?? Option.none())?.seq : undefined
}

describe("computer frames atom", () => {
  it.effect("subscribes for the computer on mount and interrupts on unmount", () =>
    Effect.gen(function* () {
      const { runtime, calls, interrupts } = yield* setup()
      const { framesAtom } = createComputerAtoms(runtime)
      const registry = AtomRegistry.make()
      const atom = framesAtom(PC)

      const unmount = registry.mount(atom)
      yield* yieldTimes(40)
      expect(calls).toEqual(["pc.frames"])

      unmount()
      yield* yieldTimes(20)
      expect(interrupts).toEqual(["pc.frames"])
    }),
  )

  it.effect("keeps the newest frame while a viewer is mounted", () =>
    Effect.gen(function* () {
      const { runtime, calls, frames, seen } = yield* setup()
      const { framesAtom } = createComputerAtoms(runtime)
      const registry = AtomRegistry.make()
      const atom = framesAtom(PC)

      const unmount = registry.mount(atom)
      yield* yieldTimes(40)
      expect(calls).toEqual(["pc.frames"])

      yield* Queue.offer(frames, frame(2))
      yield* Deferred.await(seen)
      yield* yieldTimes(20)
      expect(latest(registry, atom)).toBe(2)

      unmount()
      yield* yieldTimes(20)
    }),
  )
})
