import type { Member, Message, MessageId, RoomId, RoomSnapshot, UserSignal } from "@kiko/protocol"
import type { RoomStreamItem } from "@kiko/protocol/rpc"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as PubSub from "effect/PubSub"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import * as SubscriptionRef from "effect/SubscriptionRef"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRegistry from "effect/reactivity/AtomRegistry"
import type { PreparedConnection, SupervisorConnectionState } from "../connection/model"
import { OwnerSupervisor } from "../connection/supervisor"
import * as Wakeups from "../connection/wakeups"
import { layer as cacheLayer, layerMemoryStore, SnapshotCache, SnapshotStore } from "../platform/cache"
import type { OwnerRpcClient } from "../rpc/protocol"
import type { RpcSession } from "../rpc/session"
import { runAtomCommand } from "./atomCommand"
import { createOwnerAtoms } from "./atoms"
import * as Pending from "./pending"
import type { RoomState } from "./roomState"
import type { OwnerRuntimeServices } from "./runtime"
import { emptyStreamState } from "./stream"
import { UserStore, type UserState } from "./userState"

const ROOM = "01890000-0000-7000-8000-000000000001" as RoomId

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

const message = (seq: number, text: string): Message => ({
  id: `${seq}.room` as MessageId,
  seq,
  at: seq,
  from: { kind: "agent", slug: "kiko" as never },
  text,
})

const roomSnapshot = (seq: number, messages: Message[]): RoomSnapshot => ({
  seq,
  readSeq: 0,
  members: [],
  messages,
  tasks: [],
  files: [],
  folders: [],
})

const setup = Effect.fnUntraced(function* (connected = true) {
  const subscribes: Array<{ readonly roomId: RoomId; readonly afterSequence?: number }> = []
  const feeds: Array<Queue.Queue<RoomStreamItem>> = []
  const reads: string[] = []
  const values = new Map<string, string>()
  const requests: Array<{ readonly tag: string; readonly input: unknown }> = []
  const store = SnapshotStore.of({
    read: (key) => Effect.sync(() => (reads.push(key), Option.fromNullishOr(values.get(key)))),
    write: (key, value) => Effect.sync(() => void values.set(key, value)),
    remove: (key) => Effect.sync(() => void values.delete(key)),
  })
  const client = ((tag: string, input: { roomId: RoomId; afterSequence?: number }) => {
    if (tag === "room.send") return Effect.never
    if (tag === "memory.run") return Effect.succeed({ ok: true, text: ["remembered"] })
    if (tag === "pc.pairCode") return Effect.succeed({ code: "c", url: "https://kiko.example/pc#c", expiresAt: 1 })
    if (tag === "recipes.install") {
      requests.push({ tag, input })
      return Effect.succeed({ state: "needs_connect", links: [] })
    }
    if (tag !== "room.subscribe") return Effect.die(`unexpected ${tag}`)
    subscribes.push(input)
    return Stream.unwrap(
      Effect.gen(function* () {
        const feed = yield* Queue.unbounded<RoomStreamItem>()
        feeds.push(feed)
        return Stream.fromQueue(feed)
      }),
    )
  }) as unknown as OwnerRpcClient
  const session: RpcSession = { client, ready: Effect.void, probe: Effect.void, closed: Effect.never }
  const sessions = yield* SubscriptionRef.make(connected ? Option.some(session) : Option.none<RpcSession>())
  const supervisor = OwnerSupervisor.of({
    state: yield* SubscriptionRef.make(CONNECTED),
    session: sessions,
    prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  })
  const user = UserStore.of({
    state: yield* SubscriptionRef.make<UserState>({ ...emptyStreamState(), build: {} }),
    signals: yield* PubSub.unbounded<UserSignal>(),
    disconnected: Effect.void,
  })
  const servicesWith = (snapshots: Layer.Layer<SnapshotStore>) =>
    Layer.mergeAll(
      Layer.succeed(OwnerSupervisor, supervisor),
      Layer.succeed(UserStore, user),
      cacheLayer.pipe(Layer.provide(snapshots)),
      Pending.layer,
      Wakeups.layerNone,
    )
  const services = servicesWith(Layer.succeed(SnapshotStore, store))
  const cache = yield* SnapshotCache.pipe(
    Effect.provide(cacheLayer.pipe(Layer.provide(Layer.succeed(SnapshotStore, store)))),
  )
  const runtime = Atom.runtime(services) as unknown as Atom.AtomRuntime<OwnerRuntimeServices, never>
  const owner = createOwnerAtoms(runtime)
  const registry = AtomRegistry.make()
  registry.mount(owner.connectionAtom)
  return { owner, registry, subscribes, feeds, reads, cache, session, sessions, requests, user, services, servicesWith }
})

const settle = Effect.repeat(Effect.yieldNow, { times: 50 })

const stateOf = (registry: AtomRegistry.AtomRegistry, owner: ReturnType<typeof createOwnerAtoms>): RoomState =>
  registry.get(owner.roomAtom(ROOM))

describe("room atoms", () => {
  it.effect("a room returned to while its state is retained stays live through catch-up", () =>
    Effect.gen(function* () {
      const { owner, registry, subscribes, feeds } = yield* setup()
      const leave = registry.mount(owner.roomAtom(ROOM))
      yield* settle
      yield* Queue.offerAll(feeds[0]!, [
        { kind: "snapshot", snapshot: roomSnapshot(2, [message(1, "a"), message(2, "b")]) },
        { kind: "synchronized" },
      ])
      yield* settle
      expect(stateOf(registry, owner).status).toBe("live")
      leave()
      yield* settle

      const seen: string[] = []
      const back = registry.subscribe(owner.roomAtom(ROOM), (state) => seen.push(state.status), { immediate: true })
      yield* settle
      expect(subscribes.at(-1)).toEqual({ roomId: ROOM, afterSequence: 2 })
      yield* Queue.offerAll(feeds.at(-1)!, [
        { kind: "event", sequence: 3, event: { t: "message", ...message(3, "c") } },
        { kind: "synchronized" },
      ])
      yield* settle
      expect(new Set(seen)).toEqual(new Set(["live"]))
      expect(Option.getOrThrow(stateOf(registry, owner).data).messages.map((m) => m.text)).toEqual(["a", "b", "c"])
      back()
    }),
  )

  it.effect("a snapshot cached on disk by an earlier session is not shown as live", () =>
    Effect.gen(function* () {
      const { owner, registry, cache, feeds } = yield* setup()
      yield* cache.saveRoom(ROOM, { sequence: 1, snapshot: roomSnapshot(1, [message(1, "old")]) })
      const leave = registry.mount(owner.roomAtom(ROOM))
      yield* settle
      const state = stateOf(registry, owner)
      expect(Option.isSome(state.data)).toBe(true)
      expect(state.status).not.toBe("live")
      yield* Queue.offer(feeds[0]!, { kind: "synchronized" })
      yield* settle
      expect(stateOf(registry, owner).status).toBe("live")
      leave()
    }),
  )

  it.effect("a room whose cached snapshot was already loaded paints it at once without reading disk again", () =>
    Effect.gen(function* () {
      const { owner, registry, cache, reads, subscribes } = yield* setup()
      yield* cache.saveRoom(ROOM, { sequence: 4, snapshot: roomSnapshot(4, [message(4, "hovered")]) })
      const hover = registry.mount(owner.cachedRoomAtom(ROOM))
      yield* settle
      expect(reads).toHaveLength(1)

      const leave = registry.mount(owner.roomAtom(ROOM))
      const first = stateOf(registry, owner)
      expect(Option.getOrThrow(first.data).messages.map((m) => m.text)).toEqual(["hovered"])
      expect(first.status).toBe("cached")
      yield* settle
      expect(reads).toHaveLength(1)
      expect(subscribes).toEqual([{ roomId: ROOM, afterSequence: 4 }])
      leave()
      hover()
    }),
  )

  it.effect("a room opened before the disk cache is attached paints the cached snapshot once it is", () =>
    Effect.gen(function* () {
      const { registry, cache, subscribes, services, servicesWith } = yield* setup()
      yield* cache.saveRoom(ROOM, { sequence: 5, snapshot: roomSnapshot(5, [message(5, "on disk")]) })
      const attached = Atom.make(false)
      const runtime = Atom.runtime((get) =>
        get(attached) ? services : servicesWith(layerMemoryStore),
      ) as unknown as Atom.AtomRuntime<OwnerRuntimeServices, never>
      const owner = createOwnerAtoms(runtime)
      const leave = registry.mount(owner.roomAtom(ROOM))
      yield* settle
      registry.set(attached, true)
      yield* settle
      const state = stateOf(registry, owner)
      expect(Option.getOrThrow(state.data).messages.map((m) => m.text)).toEqual(["on disk"])
      expect(subscribes.at(-1)).toEqual({ roomId: ROOM, afterSequence: 5 })
      leave()
    }),
  )

  it.effect("a new chat starts settled and empty, and shows a pending send before the server answers", () =>
    Effect.gen(function* () {
      const { owner, registry, reads, subscribes } = yield* setup()
      const lead: Member = { slug: "kiko" as never, name: "Kiko", lead: true }
      owner.seedNewRoom(registry, ROOM, [lead])
      const leave = registry.mount(owner.roomAtom(ROOM))
      const first = stateOf(registry, owner)
      expect(first.status).toBe("live")
      expect(Option.getOrThrow(first.data)).toMatchObject({ seq: 0, members: [lead], messages: [] })

      const sending = registry.mount(owner.sendMessageAtom)
      registry.set(owner.sendMessageAtom, { roomId: ROOM, text: "hello" })
      yield* settle
      expect(Option.getOrThrow(stateOf(registry, owner).data).messages.map((m) => m.text)).toEqual(["hello"])
      expect(reads).toEqual([])
      expect(subscribes).toEqual([{ roomId: ROOM, afterSequence: 0 }])
      sending()
      leave()
    }),
  )
})

describe("memory commands", () => {
  it.effect("a memory read made while Kiko is still connecting answers once it connects", () =>
    Effect.gen(function* () {
      const { owner, registry, session, sessions } = yield* setup(false)
      const read = yield* Effect.forkChild(
        Effect.promise(() => runAtomCommand(registry, owner.commands.memory, { op: { op: "view" } })),
      )
      yield* settle
      yield* SubscriptionRef.set(sessions, Option.some(session))
      const result = yield* Fiber.join(read)
      expect(result).toMatchObject({ _tag: "Success", value: { ok: true, text: ["remembered"] } })
    }),
  )

  it.effect("a memory change made while Kiko is not connected fails at once", () =>
    Effect.gen(function* () {
      const { owner, registry } = yield* setup(false)
      const result = yield* Effect.promise(() =>
        runAtomCommand(
          registry,
          owner.commands.memory,
          { op: { op: "pin", pos: 1, pinned: true } },
          {
            warn: () => {},
            error: () => {},
          },
        ),
      )
      expect(result._tag).toBe("Failure")
    }),
  )
})

describe("user signals", () => {
  it.effect("a burst of signals reaches the listener in full, not only the last one", () =>
    Effect.gen(function* () {
      const { owner, registry, user } = yield* setup()
      const seen: string[] = []
      const stop = registry.subscribe(
        owner.userSignalAtom,
        (next) => {
          if (!AsyncResult.isSuccess(next) || Option.isNone(next.value)) return
          const value: unknown = next.value.value
          for (const signal of (Array.isArray(value) ? value : [value]) as UserSignal[]) seen.push(signal.t)
        },
        { immediate: true },
      )
      yield* settle
      yield* PubSub.publishAll(user.signals, [
        { t: "browserState", state: null },
        { t: "pcState", computers: [] },
        { t: "typing", roomId: ROOM, names: [] },
      ] as UserSignal[])
      yield* settle
      expect(seen).toEqual(["browserState", "pcState", "typing"])
      stop()
    }),
  )
})

describe("computer pairing", () => {
  it.effect("a pairing code asked for while Kiko is still connecting arrives once it connects", () =>
    Effect.gen(function* () {
      const { owner, registry, session, sessions } = yield* setup(false)
      const asked = yield* Effect.forkChild(
        Effect.promise(() => runAtomCommand(registry, owner.commands.pcPairCode, undefined)),
      )
      yield* settle
      yield* SubscriptionRef.set(sessions, Option.some(session))
      const result = yield* Fiber.join(asked)
      expect(result).toMatchObject({ _tag: "Success", value: { code: "c" } })
    }),
  )
})

describe("owner commands", () => {
  it.effect("a command whose payload is a union of shapes sends the caller's input", () =>
    Effect.gen(function* () {
      const { owner, registry, requests } = yield* setup()
      const body = { installId: "install-1", slug: "daily-weather", roomId: ROOM, agent: "kiko" }
      const result = yield* Effect.promise(() => runAtomCommand(registry, owner.commands.recipesInstall, body))
      expect(result._tag).toBe("Success")
      expect(requests).toEqual([{ tag: "recipes.install", input: body }])
    }),
  )
})
