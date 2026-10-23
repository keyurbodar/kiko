import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Queue from "effect/Queue"
import type * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"

const FIRST_WRITE_DELAY = "500 millis"
const WRITE_INTERVAL = "10 seconds"

export interface CachePersister<A> {
  readonly offer: (value: A) => Effect.Effect<void>
  readonly flush: Effect.Effect<void>
}

export const makeCachePersister = Effect.fnUntraced(function* <A, E>(
  persist: (value: A) => Effect.Effect<void, E>,
): Effect.fn.Return<CachePersister<A>, never, Scope.Scope> {
  const queue = yield* Queue.sliding<A>(1)
  const lock = yield* Semaphore.make(1)
  let latest: Option.Option<A> = Option.none()
  let written: Option.Option<A> = Option.none()
  const write = (value: A) =>
    lock.withPermits(1)(
      Effect.suspend(() => {
        if (Option.isSome(written) && written.value === value) return Effect.void
        return persist(value).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              written = Option.some(value)
            }),
          ),
          Effect.catchCause((cause) => Effect.logWarning("Kiko could not save its local cache.", cause)),
        )
      }),
    )
  yield* Effect.gen(function* () {
    let next = yield* Queue.take(queue)
    yield* Effect.sleep(FIRST_WRITE_DELAY)
    next = Option.getOrElse(yield* Queue.poll(queue), () => next)
    for (;;) {
      yield* write(next)
      yield* Effect.sleep(WRITE_INTERVAL)
      next = yield* Queue.take(queue)
    }
  }).pipe(Effect.forkScoped)
  const flush = Effect.suspend(() => (Option.isSome(latest) ? write(latest.value) : Effect.void))
  yield* Effect.addFinalizer(() => flush)
  return {
    offer: (value) =>
      Effect.suspend(() => {
        latest = Option.some(value)
        return Queue.offer(queue, value).pipe(Effect.asVoid)
      }),
    flush,
  }
})
