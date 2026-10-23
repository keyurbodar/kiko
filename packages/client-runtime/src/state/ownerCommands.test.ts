import type { Message, MessageId, RoomId, RoomSnapshot } from "@kiko/protocol"
import { RefusedError } from "@kiko/protocol"
import { describe, expect, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { OwnerSupervisor } from "../connection/supervisor"
import type { PreparedConnection, SupervisorConnectionState } from "../connection/model"
import type { OwnerRpcClient } from "../rpc/protocol"
import type { RpcSession } from "../rpc/session"
import { withPending } from "./overlay"
import { deleteRoomMessage, editRoomMessage, reactToRoomMessage } from "./ownerCommands"
import { layer as pendingLayer, PendingCommands, roomKey } from "./pending"

const ROOM = "01890000-0000-7000-8000-000000000003" as RoomId
const KEY = roomKey(ROOM)
const ID = "3.room" as MessageId

const message = (patch: Partial<Message> = {}): Message => ({
  id: ID,
  seq: 3,
  at: 1,
  from: { kind: "human" },
  text: "draft",
  ...patch,
})

const room = (seq: number, messages: RoomSnapshot["messages"]): RoomSnapshot => ({
  seq,
  readSeq: 0,
  members: [],
  messages,
  tasks: [],
  files: [],
  folders: [],
})

const harness = Effect.fnUntraced(function* (reply: () => Effect.Effect<unknown, unknown>) {
  const client = (() => reply()) as unknown as OwnerRpcClient
  const session: RpcSession = { client, ready: Effect.void, probe: Effect.void, closed: Effect.never }
  const supervisor = OwnerSupervisor.of({
    state: yield* SubscriptionRef.make({} as SupervisorConnectionState),
    session: yield* SubscriptionRef.make(Option.some(session)),
    prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  })
  return Layer.mergeAll(Layer.succeed(OwnerSupervisor, supervisor), pendingLayer)
})

const shown = (server: RoomSnapshot) =>
  PendingCommands.use((pending) =>
    pending.rooms.get(KEY).pipe(Effect.map((items) => withPending(server, server.seq, items).messages)),
  )

describe("room command overlays", () => {
  it.effect("show an edit at once and keep it until the stream moves past the ack", () =>
    Effect.gen(function* () {
      const ack = yield* Deferred.make<void>()
      const layer = yield* harness(() => Deferred.await(ack))
      yield* Effect.gen(function* () {
        const pending = yield* PendingCommands
        const server = room(3, [message()])
        yield* pending.rooms.reconcile(KEY, server, 3)
        const editing = yield* Effect.forkChild(editRoomMessage({ roomId: ROOM, messageId: ID, text: "final" }))
        yield* Effect.yieldNow
        expect((yield* shown(server)).map((m) => m.text)).toEqual(["final"])

        yield* Deferred.succeed(ack, undefined)
        yield* Fiber.join(editing)
        expect((yield* shown(server)).map((m) => m.text)).toEqual(["final"])

        const landed = room(4, [message({ text: "final", editedAt: 2 })])
        yield* pending.rooms.reconcile(KEY, landed, 4)
        expect(yield* pending.rooms.get(KEY)).toEqual([])
      }).pipe(Effect.provide(layer))
    }),
  )

  it.effect("drop a refused delete at once and surface the tagged error", () =>
    Effect.gen(function* () {
      const layer = yield* harness(() => Effect.fail(new RefusedError({ reason: "delete", message: "Not yours." })))
      yield* Effect.gen(function* () {
        const pending = yield* PendingCommands
        const server = room(3, [message()])
        const error = yield* deleteRoomMessage({ roomId: ROOM, messageId: ID }).pipe(Effect.flip)
        expect(error._tag).toBe("RefusedError")
        expect(yield* pending.rooms.get(KEY)).toEqual([])
        expect((yield* shown(server)).map((m) => m.id)).toEqual([ID])
      }).pipe(Effect.provide(layer))
    }),
  )

  it.effect("settle a reaction as soon as the snapshot carries it", () =>
    Effect.gen(function* () {
      const layer = yield* harness(() => Effect.void)
      yield* Effect.gen(function* () {
        const pending = yield* PendingCommands
        const before = room(3, [message()])
        yield* pending.rooms.reconcile(KEY, before, 3)
        yield* reactToRoomMessage({ roomId: ROOM, messageId: ID, emoji: "👍" })
        expect((yield* shown(before))[0]?.reactions?.map((r) => r.emoji)).toEqual(["👍"])
        const reacted = room(3, [message({ reactions: [{ emoji: "👍", by: { kind: "human" } }] })])
        yield* pending.rooms.reconcile(KEY, reacted, 3)
        expect(yield* pending.rooms.get(KEY)).toEqual([])
      }).pipe(Effect.provide(layer))
    }),
  )
})
