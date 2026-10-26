import type { MessageId, RoomId, RoomSnapshot } from "@kiko/protocol"
import { NotFoundError, RefusedError } from "@kiko/protocol"
import { describe, expect, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as SubscriptionRef from "effect/SubscriptionRef"
import { OwnerSupervisor } from "../connection/supervisor"
import type { OwnerRpcClient } from "../rpc/protocol"
import type { RpcSession } from "../rpc/session"
import type { PreparedConnection, SupervisorConnectionState } from "../connection/model"
import { createChat, sendMessage } from "./commands"
import { withPending } from "./overlay"
import { layer as pendingLayer, PendingCommands, roomKey } from "./pending"

const ROOM = "01890000-0000-7000-8000-000000000002" as RoomId
const KEY = roomKey(ROOM)

const room = (seq: number, messages: RoomSnapshot["messages"] = []): RoomSnapshot => ({
  seq,
  readSeq: 0,
  members: [],
  messages,
  tasks: [],
  files: [],
  folders: [],
})

type Reply = Effect.Effect<unknown, unknown>

const harness = Effect.fnUntraced(function* (connected: boolean, reply: (tag: string, payload: unknown) => Reply) {
  const client = ((tag: string, payload: unknown) => reply(tag, payload)) as unknown as OwnerRpcClient
  const session: RpcSession = { client, ready: Effect.void, probe: Effect.void, closed: Effect.never }
  const supervisor = OwnerSupervisor.of({
    state: yield* SubscriptionRef.make({} as SupervisorConnectionState),
    session: yield* SubscriptionRef.make(connected ? Option.some(session) : Option.none()),
    prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  })
  const layer: Layer.Layer<OwnerSupervisor | PendingCommands> = Layer.mergeAll(
    Layer.succeed(OwnerSupervisor, supervisor),
    pendingLayer,
  )
  return layer
})

const view = (server: RoomSnapshot) =>
  PendingCommands.use((pending) =>
    pending.rooms
      .get(KEY)
      .pipe(Effect.map((items) => withPending(server, server.seq, items).messages.map((m) => m.text))),
  )

describe("optimistic overlays", () => {
  it.effect("show a send at once, keep it through the ack, and drop it when the stream reaches its sequence", () =>
    Effect.gen(function* () {
      const ack = yield* Deferred.make<{ id: MessageId; seq: number }>()
      const layer = yield* harness(true, () => Deferred.await(ack))
      yield* Effect.gen(function* () {
        const pending = yield* PendingCommands
        const sending = yield* Effect.forkChild(sendMessage({ roomId: ROOM, text: "hello" }))
        yield* Effect.yieldNow
        const server = room(4)
        expect(yield* view(server)).toEqual(["hello"])

        yield* Deferred.succeed(ack, { id: "5.room" as MessageId, seq: 5 })
        const sent = yield* Fiber.join(sending)
        expect(sent.seq).toBe(5)
        yield* pending.rooms.reconcile(KEY, server, 4)
        expect(yield* view(server)).toEqual(["hello"])

        const landed = room(5, [
          {
            id: "5.room" as MessageId,
            clientId: sent.commandId,
            seq: 5,
            at: 1,
            from: { kind: "human" },
            text: "hello",
          },
        ])
        yield* pending.rooms.reconcile(KEY, landed, 5)
        expect(yield* pending.rooms.get(KEY)).toEqual([])
        expect(yield* view(landed)).toEqual(["hello"])
      }).pipe(Effect.provide(layer))
    }),
  )

  it.effect("drop a failed send at once and surface the tagged error", () =>
    Effect.gen(function* () {
      const layer = yield* harness(true, () => Effect.fail(new RefusedError({ reason: "send", message: "Too long." })))
      yield* Effect.gen(function* () {
        const pending = yield* PendingCommands
        const error = yield* sendMessage({ roomId: ROOM, text: "x".repeat(10) }).pipe(Effect.flip)
        expect(error._tag).toBe("RefusedError")
        expect(yield* pending.rooms.get(KEY)).toEqual([])
      }).pipe(Effect.provide(layer))
    }),
  )

  it.effect("refuse a send while not connected without adding an overlay", () =>
    Effect.gen(function* () {
      const layer = yield* harness(false, () => Effect.die("must not be called"))
      yield* Effect.gen(function* () {
        const pending = yield* PendingCommands
        const error = yield* sendMessage({ roomId: ROOM, text: "hello" }).pipe(Effect.flip)
        expect(error._tag).toBe("OwnerRpcUnavailableError")
        expect(yield* pending.rooms.get(KEY)).toEqual([])
      }).pipe(Effect.provide(layer))
    }),
  )

  it.effect("keep a created chat until the user stream shows it, and drop it on failure", () =>
    Effect.gen(function* () {
      const ok = yield* harness(true, () => Effect.void)
      yield* Effect.gen(function* () {
        const pending = yield* PendingCommands
        const roomId = yield* createChat({ title: "Plans" })
        const user = { seq: 1, chats: [], home: { files: [], folders: [] } }
        const items = yield* pending.user.get("user")
        expect(withPending(user, 1, items).chats.map((c) => c.title)).toEqual(["Plans"])
        yield* pending.user.reconcile("user", { ...user, chats: withPending(user, 1, items).chats }, 2)
        expect((yield* pending.user.get("user")).length).toBe(0)
        expect(roomId).toBeTypeOf("string")
      }).pipe(Effect.provide(ok))

      const failing = yield* harness(true, () => Effect.fail(new NotFoundError({ resource: "room", message: "gone" })))
      yield* Effect.gen(function* () {
        const pending = yield* PendingCommands
        const error = yield* createChat({ title: "Plans" }).pipe(Effect.flip)
        expect(error._tag).toBe("NotFoundError")
        expect(yield* pending.user.get("user")).toEqual([])
      }).pipe(Effect.provide(failing))
    }),
  )
})
