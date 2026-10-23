import type { CommandId, RoomId, RoomSnapshot, UserSnapshot } from "@kiko/protocol"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { prunePending, type PendingCommand } from "./overlay"

type Pending<S> = ReadonlyArray<PendingCommand<S>>

export interface PendingLane<S, K extends string> {
  readonly changes: (key: K) => Stream.Stream<Pending<S>>
  readonly get: (key: K) => Effect.Effect<Pending<S>>
  readonly add: (key: K, item: PendingCommand<S>) => Effect.Effect<void>
  readonly remove: (key: K, commandId: CommandId) => Effect.Effect<void>
  readonly confirm: (key: K, commandId: CommandId, sequence?: number) => Effect.Effect<void>
  readonly confirmNext: (key: K, commandId: CommandId) => Effect.Effect<void>
  readonly reconcile: (key: K, snapshot: S, sequence: number) => Effect.Effect<void>
}

const makeLane = Effect.fnUntraced(function* <S, K extends string>() {
  const EMPTY: Pending<S> = []
  const ref = yield* SubscriptionRef.make<ReadonlyMap<K, Pending<S>>>(new Map())
  const latest = new Map<K, { readonly snapshot: S; readonly sequence: number }>()
  const edit = (key: K, update: (items: Pending<S>) => Pending<S>) =>
    SubscriptionRef.update(ref, (all) => {
      const before = all.get(key) ?? EMPTY
      const after = update(before)
      if (after === before) return all
      const next = new Map(all)
      if (after.length === 0) next.delete(key)
      else next.set(key, after)
      return next
    })
  const prune = (key: K, items: Pending<S>) => {
    const server = latest.get(key)
    return server === undefined ? items : prunePending(items, server.snapshot, server.sequence)
  }
  const confirm = (key: K, commandId: CommandId, sequence?: number) =>
    edit(key, (items) =>
      prune(
        key,
        items.map((x) => (x.commandId === commandId && sequence !== undefined ? { ...x, sequence } : x)),
      ),
    )
  const lane: PendingLane<S, K> = {
    changes: (key) =>
      SubscriptionRef.changes(ref).pipe(
        Stream.map((all) => all.get(key) ?? EMPTY),
        Stream.changes,
      ),
    get: (key) => SubscriptionRef.get(ref).pipe(Effect.map((all) => all.get(key) ?? EMPTY)),
    add: (key, item) => edit(key, (items) => [...items.filter((x) => x.commandId !== item.commandId), item]),
    remove: (key, commandId) =>
      edit(key, (items) =>
        items.some((x) => x.commandId === commandId) ? items.filter((x) => x.commandId !== commandId) : items,
      ),
    confirm,
    confirmNext: (key, commandId) =>
      Effect.suspend(() => confirm(key, commandId, (latest.get(key)?.sequence ?? 0) + 1)),
    reconcile: (key, snapshot, sequence) =>
      Effect.suspend(() => {
        latest.set(key, { snapshot, sequence })
        return edit(key, (items) => (items.length === 0 ? items : prunePending(items, snapshot, sequence)))
      }),
  }
  return lane
})

export type RoomKey = `room:${RoomId}`

export const roomKey = (roomId: RoomId): RoomKey => `room:${roomId}`

export class PendingCommands extends Context.Service<
  PendingCommands,
  {
    readonly user: PendingLane<UserSnapshot, "user">
    readonly rooms: PendingLane<RoomSnapshot, RoomKey>
  }
>()("@kiko/client-runtime/state/PendingCommands") {}

export const layer = Layer.effect(
  PendingCommands,
  Effect.gen(function* () {
    return PendingCommands.of({
      user: yield* makeLane<UserSnapshot, "user">(),
      rooms: yield* makeLane<RoomSnapshot, RoomKey>(),
    })
  }),
)
