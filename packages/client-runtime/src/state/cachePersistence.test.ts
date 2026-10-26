import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Ref from "effect/Ref"
import * as TestClock from "effect/testing/TestClock"
import { makeCachePersister } from "./cachePersistence"

describe("cache persistence", () => {
  it.effect("writes at most every 10 seconds, latest wins, and flushes on demand", () =>
    Effect.gen(function* () {
      const writes = yield* Ref.make<ReadonlyArray<number>>([])
      const persister = yield* makeCachePersister((value: number) => Ref.update(writes, (all) => [...all, value]))
      yield* persister.offer(1)
      yield* persister.offer(2)
      yield* TestClock.adjust("500 millis")
      expect(yield* Ref.get(writes)).toEqual([2])

      yield* persister.offer(3)
      yield* persister.offer(4)
      yield* TestClock.adjust("9 seconds")
      expect(yield* Ref.get(writes)).toEqual([2])
      yield* TestClock.adjust("1 second")
      expect(yield* Ref.get(writes)).toEqual([2, 4])

      yield* persister.offer(5)
      yield* persister.flush
      yield* persister.flush
      expect(yield* Ref.get(writes)).toEqual([2, 4, 5])
    }).pipe(Effect.scoped),
  )
})
