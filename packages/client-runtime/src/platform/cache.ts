import { RoomId, RoomSnapshot, UserSnapshot } from "@kiko/protocol"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"

const SNAPSHOT_CACHE_SCHEMA_VERSION = 1 as const

export class SnapshotCacheError extends Schema.TaggedError<SnapshotCacheError>()("SnapshotCacheError", {
  operation: Schema.Literals(["open", "read", "write", "remove"]),
  message: Schema.String,
}) {}

export class SnapshotStore extends Context.Service<
  SnapshotStore,
  {
    readonly read: (key: string) => Effect.Effect<Option.Option<string>, SnapshotCacheError>
    readonly write: (key: string, value: string) => Effect.Effect<void, SnapshotCacheError>
    readonly remove: (key: string) => Effect.Effect<void, SnapshotCacheError>
  }
>()("@kiko/client-runtime/platform/SnapshotStore") {}

const entry = <S extends Schema.Top>(snapshot: S) =>
  Schema.Struct({
    schemaVersion: Schema.Literal(SNAPSHOT_CACHE_SCHEMA_VERSION),
    sequence: Schema.Number,
    snapshot,
  })

const StoredUserSnapshot = entry(UserSnapshot)
const StoredRoomSnapshot = Schema.Struct({ ...entry(RoomSnapshot).fields, roomId: RoomId })

export interface CachedSnapshot<S> {
  readonly sequence: number
  readonly snapshot: S
}

function decodeOrDiscard<A, E, R, E2, R2>(
  decode: Effect.Effect<Option.Option<A>, E, R>,
  discard: Effect.Effect<void, E2, R2>,
) {
  return decode.pipe(Effect.catch(() => discard.pipe(Effect.as(Option.none<A>()))))
}

export class SnapshotCache extends Context.Service<
  SnapshotCache,
  {
    readonly loadUser: Effect.Effect<Option.Option<CachedSnapshot<UserSnapshot>>, SnapshotCacheError>
    readonly saveUser: (value: CachedSnapshot<UserSnapshot>) => Effect.Effect<void, SnapshotCacheError>
    readonly loadRoom: (
      roomId: RoomId,
    ) => Effect.Effect<Option.Option<CachedSnapshot<RoomSnapshot>>, SnapshotCacheError>
    readonly saveRoom: (roomId: RoomId, value: CachedSnapshot<RoomSnapshot>) => Effect.Effect<void, SnapshotCacheError>
    readonly removeRoom: (roomId: RoomId) => Effect.Effect<void, SnapshotCacheError>
  }
>()("@kiko/client-runtime/platform/SnapshotCache") {}

const StoredUserJson = Schema.fromJsonString(Schema.toCodecJson(StoredUserSnapshot))
const StoredRoomJson = Schema.fromJsonString(Schema.toCodecJson(StoredRoomSnapshot))
const decodeUser = Schema.decodeUnknownEffect(StoredUserJson)
const encodeUser = Schema.encodeEffect(StoredUserJson)
const decodeRoom = Schema.decodeUnknownEffect(StoredRoomJson)
const encodeRoom = Schema.encodeEffect(StoredRoomJson)

const encodeFailed = (message: string) => new SnapshotCacheError({ operation: "write", message })

const make = Effect.gen(function* () {
  const store = yield* SnapshotStore
  const userKey = "user"
  const roomKey = (roomId: RoomId) => `room:${roomId}`

  const load = <A>(key: string, decode: (raw: string) => Effect.Effect<A, unknown>) =>
    store.read(key).pipe(
      Effect.flatMap((raw) =>
        decodeOrDiscard(
          Option.match(raw, {
            onNone: () => Effect.succeed(Option.none<A>()),
            onSome: (text) => decode(text).pipe(Effect.map(Option.some)),
          }),
          store.remove(key),
        ),
      ),
    )

  return SnapshotCache.of({
    loadUser: load(userKey, (raw) =>
      decodeUser(raw).pipe(Effect.map(({ sequence, snapshot }) => ({ sequence, snapshot }))),
    ),
    saveUser: ({ sequence, snapshot }) =>
      encodeUser({ schemaVersion: SNAPSHOT_CACHE_SCHEMA_VERSION, sequence, snapshot }).pipe(
        Effect.mapError((error) => encodeFailed(error.message)),
        Effect.flatMap((text) => store.write(userKey, text)),
      ),
    loadRoom: (roomId) =>
      load(roomKey(roomId), (raw) =>
        decodeRoom(raw).pipe(
          Effect.filterOrFail(
            (stored) => stored.roomId === roomId,
            () => encodeFailed("cached room does not match its key"),
          ),
          Effect.map(({ sequence, snapshot }) => ({ sequence, snapshot })),
        ),
      ),
    saveRoom: (roomId, { sequence, snapshot }) =>
      encodeRoom({ schemaVersion: SNAPSHOT_CACHE_SCHEMA_VERSION, sequence, snapshot, roomId }).pipe(
        Effect.mapError((error) => encodeFailed(error.message)),
        Effect.flatMap((text) => store.write(roomKey(roomId), text)),
      ),
    removeRoom: (roomId) => store.remove(roomKey(roomId)),
  })
})

export const layer = Layer.effect(SnapshotCache, make)

export const layerMemoryStore = Layer.sync(SnapshotStore, () => {
  const values = new Map<string, string>()
  return SnapshotStore.of({
    read: (key) => Effect.sync(() => Option.fromNullishOr(values.get(key))),
    write: (key, value) => Effect.sync(() => void values.set(key, value)),
    remove: (key) => Effect.sync(() => void values.delete(key)),
  })
})
