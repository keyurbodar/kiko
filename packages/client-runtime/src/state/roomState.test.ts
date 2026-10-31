import type { AgentSlug, RoomId, RoomSignal, RoomSnapshot, UserEvent } from "@kiko/protocol"
import { NotFoundError } from "@kiko/protocol"
import type { RoomStreamItem } from "@kiko/protocol/rpc"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as PubSub from "effect/PubSub"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as TestClock from "effect/testing/TestClock"
import type { PreparedConnection, SupervisorConnectionState } from "../connection/model"
import { OwnerSupervisor } from "../connection/supervisor"
import * as Wakeups from "../connection/wakeups"
import { layer as cacheLayer, SnapshotCache, SnapshotStore } from "../platform/cache"
import type { OwnerRpcClient } from "../rpc/protocol"
import { UserFeed, type RpcSession } from "../rpc/session"
import { ChatRemovals, layer as chatRemovalsLayer } from "./chatRemovals"
import * as Pending from "./pending"
import { makeRoomState, markCatchingUp, type RoomResumeCache, type RoomState } from "./roomState"
import { layer as userLayer } from "./userState"

const snapshot = (): RoomSnapshot => ({
  seq: 7,
  readSeq: 0,
  members: [{ slug: "kiko" as AgentSlug, name: "Kiko", lead: true }],
  messages: [],
  tasks: [],
  files: [],
  folders: [],
  agents: [{ slug: "kiko" as AgentSlug, state: "working", doing: "running a command" }],
})

const working = (): RoomState => ({
  data: Option.some(snapshot()),
  sequence: 7,
  status: "live",
  error: Option.none(),
})

describe("catching up a chat", () => {
  it("drops the agent status a background tab kept, so the run it shows as working cannot outlive its own subscribe", () => {
    const state = markCatchingUp(working())
    expect(state.status).toBe("synchronizing")
    expect(state.sequence).toBe(7)
    expect(Option.getOrThrow(state.data)).toEqual({ ...snapshot(), agents: [] })
  })
})

const ROOM = "01890000-0000-7000-8000-000000000003" as RoomId

const removed: UserEvent = { t: "chat_removed", seq: 2, at: 2, roomId: ROOM }

const CONNECTED: SupervisorConnectionState = {
  desired: true,
  network: "online",
  phase: "connected",
  stage: null,
  attempt: 0,
  generation: 1,
  lastFailure: null,
  retryAt: null,
}

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
  let failures = 0
  const subscribes: Array<{ readonly roomId: RoomId; readonly afterSequence?: number }> = []
  const feeds: Array<Queue.Queue<RoomStreamItem>> = []
  const values = new Map<string, string>()
  const store = SnapshotStore.of({
    read: (key) => Effect.sync(() => Option.fromNullishOr(values.get(key))),
    write: (key, value) => Effect.sync(() => void values.set(key, value)),
    remove: (key) => Effect.sync(() => void values.delete(key)),
  })
  const client = ((tag: string, input: { roomId: RoomId; afterSequence?: number }) => {
    if (tag !== "room.subscribe") return Stream.die(`unexpected ${tag}`)
    subscribes.push(input)
    if (failures > 0) {
      failures -= 1
      return Stream.fail(new NotFoundError({ resource: "room", message: "gone" }))
    }
    return Stream.unwrap(
      Effect.gen(function* () {
        const feed = yield* Queue.unbounded<RoomStreamItem>()
        feeds.push(feed)
        return Stream.fromQueue(feed)
      }),
    )
  }) as unknown as OwnerRpcClient
  const session: RpcSession = { client, ready: Effect.void, probe: Effect.void, closed: Effect.never }
  const sessions = yield* SubscriptionRef.make(Option.some(session))
  const supervisor = OwnerSupervisor.of({
    state: yield* SubscriptionRef.make(CONNECTED),
    session: sessions,
    prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  })
  const cacheServices = cacheLayer.pipe(Layer.provide(Layer.succeed(SnapshotStore, store)))
  const cache = yield* SnapshotCache.pipe(Effect.provide(cacheServices))
  const removals = yield* ChatRemovals.pipe(Effect.provide(chatRemovalsLayer))
  const services = Layer.mergeAll(
    Layer.succeed(OwnerSupervisor, supervisor),
    cacheServices,
    Pending.layer,
    Layer.succeed(ChatRemovals, removals),
    Wakeups.layerNone,
  )
  return {
    subscribes,
    feeds,
    cache,
    session,
    sessions,
    services,
    setFailures: (count: number) => {
      failures = count
    },
  }
})

const settle = Effect.repeat(Effect.yieldNow, { times: 50 })

const open = (
  services: Layer.Layer<
    OwnerSupervisor | SnapshotCache | Pending.PendingCommands | Wakeups.ConnectionWakeups | ChatRemovals
  >,
  resume: RoomResumeCache,
) =>
  Effect.gen(function* () {
    const signals = yield* PubSub.unbounded<RoomSignal>()
    return yield* makeRoomState(ROOM, signals, { resume }).pipe(Effect.provide(services))
  })

describe("a chat that misses on subscribe", () => {
  it.effect("retries once and still comes live", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* setup()
        harness.setFailures(1)
        const resume: RoomResumeCache = { snapshot: undefined, owner: undefined }
        const state = yield* open(harness.services, resume)
        yield* settle
        expect(harness.subscribes).toHaveLength(1)

        yield* TestClock.adjust("250 millis")
        yield* settle
        expect(harness.subscribes).toHaveLength(2)

        yield* Queue.offerAll(harness.feeds[0]!, [
          { kind: "snapshot", snapshot: emptyRoom(3) },
          { kind: "synchronized" },
        ])
        yield* settle
        expect((yield* SubscriptionRef.get(state)).status).toBe("live")
        expect(resume.snapshot?.status).toBe("live")
      }),
    ),
  )

  it.effect("is missing for this session after a second miss, and the resume cache does not keep it missing", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* setup()
        yield* harness.cache.saveRoom(ROOM, { sequence: 2, snapshot: emptyRoom(2) })
        harness.setFailures(2)
        const resume: RoomResumeCache = { snapshot: undefined, owner: undefined }
        const state = yield* open(harness.services, resume)
        yield* settle
        yield* TestClock.adjust("250 millis")
        yield* settle

        expect((yield* SubscriptionRef.get(state)).status).toBe("missing")
        expect(resume.snapshot).toBeUndefined()
        expect(Option.isNone(yield* harness.cache.loadRoom(ROOM))).toBe(true)
      }),
    ),
  )

  it.effect("retries on a new session and comes live once the room exists again", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* setup()
        harness.setFailures(2)
        const resume: RoomResumeCache = { snapshot: undefined, owner: undefined }
        const state = yield* open(harness.services, resume)
        yield* settle
        yield* TestClock.adjust("250 millis")
        yield* settle
        expect((yield* SubscriptionRef.get(state)).status).toBe("missing")

        yield* SubscriptionRef.set(harness.sessions, Option.some({ ...harness.session }))
        yield* settle
        expect(harness.subscribes).toHaveLength(3)

        yield* Queue.offerAll(harness.feeds[0]!, [
          { kind: "snapshot", snapshot: emptyRoom(4) },
          { kind: "synchronized" },
        ])
        yield* settle
        expect((yield* SubscriptionRef.get(state)).status).toBe("live")
        expect(resume.snapshot?.status).toBe("live")
      }),
    ),
  )
})

describe("a chat removed from the chat list", () => {
  it.effect("does not have its snapshot written back by the room's final flush", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* setup()
        const context = yield* Layer.build(
          Layer.mergeAll(harness.services, userLayer.pipe(Layer.provide(harness.services))),
        )
        const feed = yield* UserFeed.pipe(Effect.provide(context))
        const resume: RoomResumeCache = { snapshot: undefined, owner: undefined }
        const signals = yield* PubSub.unbounded<RoomSignal>()

        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* makeRoomState(ROOM, signals, { resume }).pipe(Effect.provide(context))
            yield* settle
            yield* Queue.offerAll(harness.feeds[0]!, [
              { kind: "snapshot", snapshot: emptyRoom(3) },
              { kind: "synchronized" },
            ])
            yield* settle
            yield* feed.apply([{ kind: "event", sequence: 2, event: removed }])
          }),
        )

        yield* settle
        expect(Option.isNone(yield* harness.cache.loadRoom(ROOM))).toBe(true)
      }),
    ),
  )
})
