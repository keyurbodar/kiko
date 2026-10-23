import type { RoomId, UserSnapshot } from "@kiko/protocol"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { IDBFactory } from "fake-indexeddb"
import { layer as cacheLayer, SnapshotCache, SnapshotStore } from "./cache"
import { layer as indexedDbLayer } from "./indexedDb"

const USER: UserSnapshot = { seq: 3, chats: [], home: { files: [], folders: [] } }
const ROOM = "01890000-0000-7000-8000-000000000003" as RoomId

const stores = () => {
  const store = indexedDbLayer({ namespace: "owner", factory: new IDBFactory() })
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

  it.effect("lets another tab upgrade the database by closing on versionchange", () =>
    Effect.gen(function* () {
      const factory = new IDBFactory()
      const store = indexedDbLayer({ namespace: "owner", factory })
      yield* Effect.gen(function* () {
        const snapshots = yield* SnapshotStore
        yield* snapshots.write("user", "a")
        const upgrade = factory.open("kiko:client-runtime", 2)
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
