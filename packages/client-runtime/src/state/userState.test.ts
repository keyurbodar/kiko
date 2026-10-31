import type { RoomId, RoomSnapshot, UserEvent } from "@kiko/protocol"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { layer as cacheLayer, SnapshotCache, SnapshotStore } from "../platform/cache"
import { UserFeed } from "../rpc/session"
import { layer as chatRemovalsLayer } from "./chatRemovals"
import { layer as pendingLayer } from "./pending"
import { layer as userLayer } from "./userState"

const ROOM = "01890000-0000-7000-8000-000000000004" as RoomId

const emptyRoom = (seq: number): RoomSnapshot => ({
  seq,
  readSeq: 0,
  members: [],
  messages: [],
  tasks: [],
  files: [],
  folders: [],
})

const setup = Effect.fnUntraced(function* () {
  const values = new Map<string, string>()
  const store = SnapshotStore.of({
    read: (key) => Effect.sync(() => Option.fromNullishOr(values.get(key))),
    write: (key, value) => Effect.sync(() => void values.set(key, value)),
    remove: (key) => Effect.sync(() => void values.delete(key)),
  })
  const cacheServices = cacheLayer.pipe(Layer.provide(Layer.succeed(SnapshotStore, store)))
  const cache = yield* SnapshotCache.pipe(Effect.provide(cacheServices))
  return { cache, services: Layer.mergeAll(cacheServices, pendingLayer, chatRemovalsLayer) }
})

const removed: UserEvent = { t: "chat_removed", seq: 2, at: 2, roomId: ROOM }

describe("the chat list", () => {
  it.effect("drops a deleted chat's cached snapshot from disk", () =>
    Effect.gen(function* () {
      const { cache, services } = yield* setup()
      yield* cache.saveRoom(ROOM, { sequence: 1, snapshot: emptyRoom(1) })
      expect(Option.isSome(yield* cache.loadRoom(ROOM))).toBe(true)

      yield* Effect.gen(function* () {
        const feed = yield* UserFeed
        yield* feed.apply([{ kind: "event", sequence: 2, event: removed }])
      }).pipe(Effect.provide(userLayer.pipe(Layer.provide(services))))

      expect(Option.isNone(yield* cache.loadRoom(ROOM))).toBe(true)
    }),
  )
})
