import type { Member, Message, RoomId, RoomSignal, RoomSnapshot } from "@kiko/protocol"
import type { RoomStreamItem } from "@kiko/protocol/rpc"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as PubSub from "effect/PubSub"
import type * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { connectionProjectionPhase } from "../connection/model"
import { OwnerSupervisor } from "../connection/supervisor"
import * as ConnectionWakeups from "../connection/wakeups"
import { SnapshotCache } from "../platform/cache"
import { subscribe } from "../rpc/client"
import { makeCachePersister } from "./cachePersistence"
import { PendingCommands, roomKey } from "./pending"
import { roomReducer } from "./room"
import {
  applyStreamItems,
  cachedStreamState,
  emptyStreamState,
  markDisconnected,
  markFailed,
  markMissing,
  markSynchronizing,
  type StreamItem,
  type StreamState,
} from "./stream"

export const ROOM_SNAPSHOT_IDLE_TTL_MS = 5 * 60_000

export type RoomState = StreamState<RoomSnapshot>

export interface RoomResumeCache {
  snapshot: RoomState | undefined
  owner: object | undefined
  services?: unknown
}

type Item = StreamItem<RoomSnapshot, Extract<RoomStreamItem, { kind: "event" }>["event"], RoomSignal>

const isNotFound = (cause: Cause.Cause<unknown>) =>
  cause.reasons.some(
    (reason) => Cause.isFailReason(reason) && (reason.error as { _tag?: unknown })._tag === "NotFoundError",
  )

const failureMessage = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause)
  return error instanceof Error && error.message.trim() ? error.message : "Kiko could not open this chat."
}

function mergeBySeq(a: ReadonlyArray<Message>, b: ReadonlyArray<Message>): Message[] {
  const out: Message[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    const x = a[i]
    const y = b[j]
    if (y === undefined || (x !== undefined && x.seq < y.seq)) {
      out.push(x!)
      i++
    } else {
      if (x !== undefined && x.seq === y.seq) i++
      out.push(y)
      j++
    }
  }
  return out
}

const withPage = (state: RoomState, page: ReadonlyArray<Message>): RoomState =>
  Option.isNone(state.data) || page.length === 0
    ? state
    : {
        ...state,
        data: Option.some({ ...state.data.value, messages: mergeBySeq(page, state.data.value.messages) }),
      }

export interface RoomStateOptions {
  readonly resume?: RoomResumeCache
  readonly pages?: PubSub.PubSub<ReadonlyArray<Message>>
  readonly loaded?: RoomState
}

export const newRoomState = (members: ReadonlyArray<Member>): RoomState => ({
  data: Option.some({ seq: 0, readSeq: 0, members, messages: [], tasks: [], files: [], folders: [] }),
  sequence: 0,
  status: "live",
  error: Option.none(),
})

export const resumedState = (state: RoomState): RoomState =>
  state.status === "live" && Option.isSome(state.data) ? state : markDisconnected(state)

export const markCatchingUp = (state: RoomState): RoomState =>
  Option.isNone(state.data)
    ? markSynchronizing(state)
    : { ...markSynchronizing(state), data: Option.some({ ...state.data.value, agents: [] }) }

export const makeRoomState = Effect.fnUntraced(function* (
  roomId: RoomId,
  signals: PubSub.PubSub<RoomSignal>,
  { resume, pages, loaded }: RoomStateOptions = {},
): Effect.fn.Return<
  SubscriptionRef.SubscriptionRef<RoomState>,
  never,
  OwnerSupervisor | SnapshotCache | PendingCommands | ConnectionWakeups.ConnectionWakeups | Scope.Scope
> {
  const supervisor = yield* OwnerSupervisor
  const cache = yield* SnapshotCache
  const pending = yield* PendingCommands
  const wakeups = yield* ConnectionWakeups.ConnectionWakeups
  const owner = {}
  if (resume) resume.owner = owner
  const retained = resume?.snapshot
  const initial: RoomState =
    (retained === undefined ? undefined : resumedState(retained)) ??
    loaded ??
    Option.match(
      yield* cache
        .loadRoom(roomId)
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning("Kiko could not read a cached chat.", error.message).pipe(Effect.as(Option.none())),
          ),
        ),
      {
        onNone: () => emptyStreamState<RoomSnapshot>(),
        onSome: ({ sequence, snapshot }) => cachedStreamState(snapshot, sequence),
      },
    )
  const state = yield* SubscriptionRef.make<RoomState>(initial)
  let resumingLive = initial.status === "live"
  const lock = yield* Semaphore.make(1)
  const remember = (value: RoomState) =>
    Effect.sync(() => {
      if (resume?.owner === owner) resume.snapshot = value
    })
  const persister = yield* makeCachePersister((value: RoomState) =>
    resume !== undefined && resume.owner !== owner
      ? Effect.void
      : Option.isSome(value.data)
        ? cache.saveRoom(roomId, { sequence: value.sequence, snapshot: value.data.value })
        : Effect.void,
  )
  const update = (f: (current: RoomState) => RoomState) =>
    lock.withPermits(1)(SubscriptionRef.updateAndGet(state, f).pipe(Effect.flatMap(remember)))

  const applyItems = (items: ReadonlyArray<RoomStreamItem>) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const before = yield* SubscriptionRef.get(state)
        const after = applyStreamItems(before, items as ReadonlyArray<Item>, roomReducer)
        yield* SubscriptionRef.set(state, after)
        yield* remember(after)
        for (const item of items) if (item.kind === "signal") yield* PubSub.publish(signals, item.signal)
        if (Option.isSome(after.data)) {
          yield* pending.rooms.reconcile(roomKey(roomId), after.data.value, after.sequence)
          if (after.data !== before.data || after.sequence !== before.sequence) yield* persister.offer(after)
        }
      }),
    )

  yield* SubscriptionRef.changes(supervisor.state).pipe(
    Stream.filter((connection) => connectionProjectionPhase(connection) === "disconnected"),
    Stream.runForEach(() => update(markDisconnected).pipe(Effect.andThen(persister.flush))),
    Effect.forkScoped,
  )

  if (pages !== undefined)
    yield* Stream.fromPubSub(pages).pipe(
      Stream.runForEach((page) => update((current) => withPage(current, page))),
      Effect.forkScoped,
    )

  const missing = update(markMissing).pipe(Effect.andThen(cache.removeRoom(roomId).pipe(Effect.ignore)))

  yield* subscribe(
    "room.subscribe",
    () =>
      Effect.gen(function* () {
        const current = yield* SubscriptionRef.get(state)
        if (current.status === "missing") return yield* Effect.never
        const keepLive = resumingLive && current.status === "live"
        resumingLive = false
        if (!keepLive) yield* update(markCatchingUp)
        return Option.isSome(current.data) ? { roomId, afterSequence: current.sequence } : { roomId }
      }),
    {
      onExpectedFailure: (cause) =>
        isNotFound(cause)
          ? missing
          : update((current) => markFailed(current, failureMessage(cause))).pipe(Effect.asVoid),
      retryExpectedFailureAfter: "250 millis",
      resubscribe: wakeups.changes.pipe(Stream.filter(ConnectionWakeups.shouldResubscribeAfterWakeup)),
    },
  ).pipe(Stream.runForEachArray(applyItems), Effect.forkScoped)

  return state
})
