import type { Message, MessageId, RoomId, RoomSnapshot, UserSnapshot } from "@kiko/protocol"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { IDBFactory } from "fake-indexeddb"
import { layer as cacheLayer, SnapshotCache, SnapshotStore } from "./cache"
import { layer as indexedDbLayer } from "./indexedDb"

const USER: UserSnapshot = { seq: 3, chats: [], home: { files: [], folders: [] } }
const ROOM = "01890000-0000-7000-8000-000000000003" as RoomId

const DATABASE = "kiko:client-runtime"

const message = (seq: number): Message => ({
  id: `${seq}.room` as MessageId,
  seq,
  at: seq,
  from: { kind: "agent", slug: "kiko" as never },
  text: `m${seq}`,
})

const roomSnapshot = (seq: number, messages: ReadonlyArray<Message>): RoomSnapshot => ({
  seq,
  readSeq: 0,
  members: [],
  messages: [...messages],
  tasks: [],
  files: [],
  folders: [],
})

const stores = () => {
  const store = indexedDbLayer({ database: DATABASE, namespace: "owner", factory: new IDBFactory() })
  return Layer.mergeAll(store, cacheLayer.pipe(Layer.provide(store)))
}

describe("snapshot cache", () => {
  it.effect("round-trips the user snapshot with its sequence through IndexedDB", () =>
    Effect.gen(function* () {
      const cache = yield* SnapshotCache
      expect(Option.isNone(yield* cache.loadUser)).toBe(true)
      yield* cache.saveUser({ sequence: 3, snapshot: USER })
      expect(yield* cache.loadUser).toEqual(Option.some({ sequence: 3, snapshot: USER }))
    }).pipe(Effect.provide(stores())),
  )

  it.effect("keeps the last result of a query, so a page can paint it before the server answers", () =>
    Effect.gen(function* () {
      const cache = yield* SnapshotCache
      const Catalog = Schema.Struct({ models: Schema.Array(Schema.Struct({ id: Schema.String, at: Schema.Date })) })
      const catalog = { models: [{ id: "claude-haiku-5-5", at: new Date(1_800_000_000_000) }] }
      expect(Option.isNone(yield* cache.loadQuery("models.catalog:null", Catalog))).toBe(true)
      yield* cache.saveQuery("models.catalog:null", Catalog, catalog)
      expect(yield* cache.loadQuery("models.catalog:null", Catalog)).toEqual(Option.some(catalog))
      expect(
        Option.isNone(yield* cache.loadQuery("models.catalog:null", Schema.Struct({ other: Schema.String }))),
      ).toBe(true)
    }).pipe(Effect.provide(stores())),
  )

  it.effect("discards an entry it cannot decode instead of failing", () =>
    Effect.gen(function* () {
      const cache = yield* SnapshotCache
      const store = yield* SnapshotStore
      yield* store.write("user", "{not json")
      expect(Option.isNone(yield* cache.loadUser)).toBe(true)
      expect(Option.isNone(yield* store.read("user"))).toBe(true)

      yield* store.write(`room:${ROOM}`, JSON.stringify({ schemaVersion: 0, sequence: 1, roomId: ROOM, snapshot: {} }))
      expect(Option.isNone(yield* cache.loadRoom(ROOM))).toBe(true)
      expect(Option.isNone(yield* store.read(`room:${ROOM}`))).toBe(true)
    }).pipe(Effect.provide(stores())),
  )

  it.effect("keeps only the newest messages of a long room, so the cached write stays small", () =>
    Effect.gen(function* () {
      const cache = yield* SnapshotCache
      const messages = Array.from({ length: 260 }, (_, i) => message(i + 1))
      yield* cache.saveRoom(ROOM, { sequence: 260, snapshot: roomSnapshot(260, messages) })
      const loaded = Option.getOrThrow(yield* cache.loadRoom(ROOM))
      expect(loaded.sequence).toBe(260)
      expect(loaded.snapshot.messages).toEqual(messages.slice(-200))

      const short = [message(1), message(2)]
      yield* cache.saveRoom(ROOM, { sequence: 2, snapshot: roomSnapshot(2, short) })
      expect(Option.getOrThrow(yield* cache.loadRoom(ROOM)).snapshot.messages).toEqual(short)
    }).pipe(Effect.provide(stores())),
  )

  it.effect("skips a write whose persisted content did not change", () => {
    const writes: string[] = []
    const store = SnapshotStore.of({
      read: () => Effect.succeed(Option.none()),
      write: (key) => Effect.sync(() => void writes.push(key)),
      remove: (key) => Effect.sync(() => void writes.push(`remove:${key}`)),
    })
    return Effect.gen(function* () {
      const cache = yield* SnapshotCache
      const value = { sequence: 1, snapshot: roomSnapshot(1, [message(1)]) }
      yield* cache.saveRoom(ROOM, value)
      yield* cache.saveRoom(ROOM, value)
      expect(writes).toEqual([`room:${ROOM}`])

      yield* cache.saveRoom(ROOM, { sequence: 2, snapshot: roomSnapshot(2, [message(2)]) })
      expect(writes).toHaveLength(2)

      yield* cache.removeRoom(ROOM)
      yield* cache.saveRoom(ROOM, value)
      expect(writes.filter((key) => key === `room:${ROOM}`)).toHaveLength(3)
    }).pipe(Effect.provide(cacheLayer.pipe(Layer.provide(Layer.succeed(SnapshotStore, store)))))
  })

  it.effect("keeps each namespace's entries apart in one database", () =>
    Effect.gen(function* () {
      const factory = new IDBFactory()
      const alice = indexedDbLayer({ database: DATABASE, namespace: "alice", factory })
      const bob = indexedDbLayer({ database: DATABASE, namespace: "bob", factory })
      yield* SnapshotStore.use((store) => store.write("user", "alice's chats")).pipe(Effect.provide(alice))
      expect(Option.isNone(yield* SnapshotStore.use((store) => store.read("user")).pipe(Effect.provide(bob)))).toBe(
        true,
      )
      expect(yield* SnapshotStore.use((store) => store.read("user")).pipe(Effect.provide(alice))).toEqual(
        Option.some("alice's chats"),
      )
    }),
  )

  it.effect("lets another tab upgrade the database by closing on versionchange", () =>
    Effect.gen(function* () {
      const factory = new IDBFactory()
      const store = indexedDbLayer({ database: DATABASE, namespace: "owner", factory })
      yield* Effect.gen(function* () {
        const snapshots = yield* SnapshotStore
        yield* snapshots.write("user", "a")
        const upgrade = factory.open(DATABASE, 2)
        yield* Effect.callback<void>((resume) => {
          upgrade.addEventListener("success", () => {
            upgrade.result.close()
            resume(Effect.void)
          })
        })
      }).pipe(Effect.provide(store))
    }),
  )
})
