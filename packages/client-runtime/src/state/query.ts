import type { UserChange } from "@kiko/protocol"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
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
    const byKey = Atom.family((key: string) => {
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
    return (input: Input): Atom.Atom<AsyncResult.AsyncResult<A, E | ER | OwnerRpcUnavailableError>> =>
      byKey(JSON.stringify(input ?? null))
  }

  return { sessionAtom, changedAtom, query }
}
