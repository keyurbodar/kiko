import type { UserChange } from "@kiko/protocol"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import { OwnerSupervisor } from "../connection/supervisor"
import { OwnerRpcUnavailableError } from "../rpc/client"
import type { RpcSession } from "../rpc/session"
import { SnapshotCache } from "../platform/cache"
import type { OwnerRuntimeServices } from "./runtime"
import { UserStore } from "./userState"

const QUERY_IDLE_TTL_MS = 5 * 60_000

const isUnavailable = Schema.is(OwnerRpcUnavailableError)

const pendingOnceSessionReplaced =
  (session: RpcSession) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R | OwnerSupervisor> =>
    effect.pipe(
      Effect.catchIf(isUnavailable, (error) =>
        OwnerSupervisor.use((supervisor) => SubscriptionRef.get(supervisor.session)).pipe(
          Effect.flatMap((current) =>
            Option.isSome(current) && current.value === session ? Effect.fail(error) : Effect.never,
          ),
        ),
      ),
    )

interface QueryEdit<A> {
  readonly apply: (value: A) => A
}

const reread = <A, E>(registry: AtomRegistry.AtomRegistry, atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>) =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* AtomRegistry.mount(registry, atom)
      registry.refresh(atom)
      yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })
    }),
  ).pipe(Effect.ignore)

export interface QueryOptions<Input, A, E> {
  readonly label: string
  readonly execute: (input: Input) => Effect.Effect<A, E, OwnerRuntimeServices>
  readonly refreshOn?: UserChange
  readonly idleTtlMs?: number
  readonly cached?: Schema.Codec<A, unknown>
}

export function createQueryAtoms<ER>(runtime: Atom.AtomRuntime<OwnerRuntimeServices, ER>) {
  const sessionAtom = runtime
    .atom(Stream.unwrap(OwnerSupervisor.useSync((supervisor) => SubscriptionRef.changes(supervisor.session))), {
      initialValue: Option.none<RpcSession>(),
    })
    .pipe(Atom.keepAlive, Atom.withLabel("kiko-session"))

  const changedAtom = Atom.family((what: UserChange) =>
    runtime
      .atom(
        Stream.unwrap(UserStore.useSync((user) => Stream.fromPubSub(user.signals))).pipe(
          Stream.filter((signal) => signal.t === "changed" && signal.what === what),
          Stream.scan(
            () => 0,
            (count: number) => count + 1,
          ),
        ),
        { initialValue: 0 },
      )
      .pipe(Atom.withLabel(`kiko-changed:${what}`)),
  )

  function query<Input, A, E>(options: QueryOptions<Input, A, E>) {
    const serverByKey = Atom.family((key: string) => {
      const input = JSON.parse(key) as Input
      return runtime
        .atom((get) => {
          const session = Option.getOrUndefined(
            Option.getOrElse(AsyncResult.value(get(sessionAtom)), () => Option.none<RpcSession>()),
          )
          if (options.refreshOn !== undefined) get(changedAtom(options.refreshOn))
          const live =
            session === undefined ? Effect.never : options.execute(input).pipe(pendingOnceSessionReplaced(session))
          const schema = options.cached
          if (schema === undefined) return live
          const cacheKey = `${options.label}:${key}`
          const shown = Option.isSome(Option.flatMap(get.self<AsyncResult.AsyncResult<A, E>>(), AsyncResult.value))
          const warm = shown
            ? Effect.void
            : SnapshotCache.use((cache) => cache.loadQuery(cacheKey, schema)).pipe(
                Effect.tap((cached) =>
                  Option.isSome(cached)
                    ? Effect.sync(() => get.setSelf(AsyncResult.success(cached.value, { waiting: true })))
                    : Effect.void,
                ),
              )
          return warm.pipe(
            Effect.andThen(live),
            Effect.tap((value) => SnapshotCache.use((cache) => cache.saveQuery(cacheKey, schema, value))),
          )
        })
        .pipe(Atom.setIdleTTL(options.idleTtlMs ?? QUERY_IDLE_TTL_MS), Atom.withLabel(`${options.label}:${key}`))
    })
    const editsByKey = Atom.family((_key: string) => Atom.make<ReadonlyArray<QueryEdit<A>>>([]).pipe(Atom.keepAlive))
    const shownByKey = Atom.family((key: string) => {
      const server = serverByKey(key)
      const edits = editsByKey(key)
      return Atom.readable(
        (get) => {
          const result = get(server)
          const pending = get(edits)
          if (pending.length === 0) return result
          return AsyncResult.map(result, (value) => pending.reduce((shown, edit) => edit.apply(shown), value))
        },
        (refresh) => refresh(server),
      )
    })
    const keyOf = (input: Input) => JSON.stringify(input ?? null)
    const sendOrder = new Map<string, Semaphore.Semaphore>()
    const inOrder = (key: string) => {
      let lane = sendOrder.get(key)
      if (lane === undefined) sendOrder.set(key, (lane = Semaphore.makeUnsafe(1)))
      return lane
    }
    const edit = <B, E2, R>(input: Input, apply: (value: A) => A, send: Effect.Effect<B, E2, R>) =>
      Effect.gen(function* () {
        const registry = yield* AtomRegistry.AtomRegistry
        const key = keyOf(input)
        const edits = editsByKey(key)
        const item: QueryEdit<A> = { apply }
        const drop = Effect.sync(() => registry.update(edits, (all) => all.filter((x) => x !== item)))
        registry.update(edits, (all) => [...all, item])
        const result = yield* Effect.onError(inOrder(key).withPermit(send), () => drop)
        yield* Effect.forkDetach(reread(registry, serverByKey(key)).pipe(Effect.ensuring(drop)))
        return result
      })
    return Object.assign(
      (input: Input): Atom.Atom<AsyncResult.AsyncResult<A, E | ER | OwnerRpcUnavailableError>> =>
        shownByKey(keyOf(input)),
      { edit },
    )
  }

  return { sessionAtom, changedAtom, query }
}
