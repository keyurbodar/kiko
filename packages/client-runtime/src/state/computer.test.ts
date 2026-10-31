import type { TerminalEvent } from "@kiko/protocol"
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
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { OwnerSupervisor } from "../connection/supervisor"
import type { PreparedConnection, SupervisorConnectionState } from "../connection/model"
import type { OwnerRpcClient } from "../rpc/protocol"
import type { RpcSession } from "../rpc/session"
import { createTerminalAtoms, terminalKey, type TerminalFeed } from "./computer"
import type { OwnerRuntimeServices } from "./runtime"

const PC = "pc-1"

const setup = Effect.fnUntraced(function* () {
  const calls: string[] = []
  const interrupts: string[] = []
  const events = yield* Queue.unbounded<TerminalEvent>()
  const seen = yield* Deferred.make<void>()
  const client = ((tag: string) => {
    calls.push(tag)
    const stream = Stream.fromQueue(events)
    return (stream as Stream.Stream<unknown>).pipe(
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
  return { runtime, calls, interrupts, events, seen }
})

const yieldTimes = (n: number) => Effect.repeat(Effect.yieldNow, { times: n })

const feedOf = (result: unknown): TerminalFeed | undefined =>
  Option.getOrUndefined(AsyncResult.value(result as AsyncResult.AsyncResult<TerminalFeed, unknown>))

describe("terminal atom", () => {
  it.effect("keeps the snapshot and every live chunk in order", () =>
    Effect.gen(function* () {
      const { runtime, calls, events } = yield* setup()
      const { terminalAtom } = createTerminalAtoms(runtime)
      const registry = AtomRegistry.make()
      const feeds: TerminalFeed[] = []
      const atom = terminalAtom(terminalKey(PC, "t-1"))

      const unmount = registry.mount(atom)
      const stop = registry.subscribe(atom, (result) => {
        const feed = feedOf(result)
        if (feed) feeds.push(feed)
      })
      yield* yieldTimes(40)
      expect(calls).toEqual(["terminal.attach"])

      yield* Queue.offer(events, {
        type: "snapshot",
        history: "ready\r\n",
        cols: 120,
        rows: 30,
        status: "running",
        exitCode: null,
      })
      yield* yieldTimes(40)
      yield* Queue.offer(events, { type: "output", data: "$ ls\r\n" })
      yield* yieldTimes(40)

      expect(feeds.at(-1)?.items.map((item) => item.event.type)).toEqual(["snapshot", "output"])

      stop()
      unmount()
      yield* yieldTimes(20)
    }),
  )
})
