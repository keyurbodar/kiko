import type { UserSignal, UserSnapshot } from "@kiko/protocol"
import type { UserStreamItem } from "@kiko/protocol/rpc"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as PubSub from "effect/PubSub"
import * as Semaphore from "effect/Semaphore"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { SnapshotCache } from "../platform/cache"
import { UserFeed } from "../rpc/session"
import { makeCachePersister } from "./cachePersistence"
import { PendingCommands } from "./pending"
import {
  applyStreamItems,
  cachedStreamState,
  emptyStreamState,
  markDisconnected,
  markSynchronizing,
  type StreamItem,
  type StreamState,
} from "./stream"
import { userReducer } from "./user"

export interface ServerBuild {
  readonly version?: string
  readonly protocol?: number
  readonly fileToken?: string
}

export interface UserState extends StreamState<UserSnapshot> {
  readonly build: ServerBuild
}

export class UserStore extends Context.Service<
  UserStore,
  {
    readonly state: SubscriptionRef.SubscriptionRef<UserState>
    readonly signals: PubSub.PubSub<UserSignal>
    readonly disconnected: Effect.Effect<void>
  }
>()("@kiko/client-runtime/state/UserStore") {}

type Item = StreamItem<UserSnapshot, Extract<UserStreamItem, { kind: "event" }>["event"], UserSignal>

const buildOf = (item: UserStreamItem): ServerBuild | null => {
  if (item.kind !== "snapshot" && item.kind !== "session") return null
  return {
    ...(item.version === undefined ? {} : { version: item.version }),
    ...(item.protocol === undefined ? {} : { protocol: item.protocol }),
    ...(item.fileToken === undefined ? {} : { fileToken: item.fileToken }),
  }
}

export const layer = Layer.effectContext(
  Effect.gen(function* () {
    const cache = yield* SnapshotCache
    const pending = yield* PendingCommands
    const cached = yield* cache.loadUser.pipe(
      Effect.catch((error) =>
        Effect.logWarning("Kiko could not read its cached chat list.", error.message).pipe(Effect.as(Option.none())),
      ),
    )
    const initial: UserState = {
      ...Option.match(cached, {
        onNone: () => emptyStreamState<UserSnapshot>(),
        onSome: ({ sequence, snapshot }) => cachedStreamState(snapshot, sequence),
      }),
      build: {},
    }
    const state = yield* SubscriptionRef.make(initial)
    const signals = yield* PubSub.unbounded<UserSignal>()
    const lock = yield* Semaphore.make(1)
    const persister = yield* makeCachePersister((value: StreamState<UserSnapshot>) =>
      Option.isSome(value.data)
        ? cache.saveUser({ sequence: value.sequence, snapshot: value.data.value })
        : Effect.void,
    )

    const apply = (items: ReadonlyArray<UserStreamItem>) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          const before = yield* SubscriptionRef.get(state)
          const build: ServerBuild = Object.assign(
            {},
            before.build,
            ...items.map(buildOf).filter((next) => next !== null),
          )
          const merged = applyStreamItems(before, items as ReadonlyArray<Item>, userReducer)
          const after: UserState = { ...merged, build }
          yield* SubscriptionRef.set(state, after)
          for (const item of items) if (item.kind === "signal") yield* PubSub.publish(signals, item.signal)
          if (Option.isSome(after.data)) {
            yield* pending.user.reconcile("user", after.data.value, after.sequence)
            if (after.data !== before.data || after.sequence !== before.sequence) yield* persister.offer(merged)
          }
        }),
      )

    const afterSequence = lock.withPermits(1)(
      SubscriptionRef.modify(state, (current) => {
        const next = { ...markSynchronizing(current), build: current.build }
        return [Option.isSome(current.data) ? current.sequence : undefined, next] as const
      }),
    )

    const disconnected = SubscriptionRef.update(state, (current) => ({
      ...markDisconnected(current),
      build: current.build,
    })).pipe(Effect.andThen(persister.flush))

    return Context.make(UserStore, UserStore.of({ state, signals, disconnected })).pipe(
      Context.add(UserFeed, UserFeed.of({ afterSequence, apply })),
    )
  }),
)
