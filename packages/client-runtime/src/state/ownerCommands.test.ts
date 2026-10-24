import type {
  AgentSlug,
  Message,
  MessageId,
  RoomId,
  RoomSnapshot,
  RoutineRow,
  SoulRow,
  UserSnapshot,
} from "@kiko/protocol"
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
import {
  cancelRoutine,
  deleteRoomMessage,
  editRoomMessage,
  reactToRoomMessage,
  updateRoutine,
  updateSoul,
} from "./ownerCommands"
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

const SLUG = "scout" as AgentSlug

const soul = (patch: Partial<SoulRow> = {}): SoulRow => ({ id: SLUG, body: "old", sha: "sha-old", at: 1, ...patch })

const routine = (patch: Partial<RoutineRow> = {}): RoutineRow => ({
  id: "r1",
  name: "Daily",
  roomId: ROOM,
  status: "active",
  trigger: { on: "time", at: "2026-01-01T00:00:00.000Z" },
  tz: "UTC",
  ...patch,
})

const user = (seq: number, rows: UserSnapshot["rows"]): UserSnapshot => ({
  seq,
  chats: [],
  home: { files: [], folders: [] },
  rows,
})

const shownRows = (server: UserSnapshot) =>
  PendingCommands.use((pending) =>
    pending.user.get("user").pipe(Effect.map((items) => withPending(server, server.seq, items).rows)),
  )

describe("user row overlays", () => {
  it.effect("show a saved soul at once and hand over to the server row with its new sha", () =>
    Effect.gen(function* () {
      const ack = yield* Deferred.make<void>()
      const layer = yield* harness(() => Deferred.await(ack))
      yield* Effect.gen(function* () {
        const pending = yield* PendingCommands
        const before = user(5, { soul: [soul()] })
        yield* pending.user.reconcile("user", before, 5)
        const saving = yield* Effect.forkChild(updateSoul({ slug: SLUG, body: "new", expectSha: "sha-old" }))
        yield* Effect.yieldNow
        expect((yield* shownRows(before))?.soul?.map((r) => r.body)).toEqual(["new"])

        const landed = user(6, { soul: [soul({ body: "new", sha: "sha-new", at: 2 })] })
        yield* pending.user.reconcile("user", landed, 6)
        yield* Deferred.succeed(ack, undefined)
        yield* Fiber.join(saving)
        expect(yield* pending.user.get("user")).toEqual([])
        expect((yield* shownRows(landed))?.soul?.map((r) => r.sha)).toEqual(["sha-new"])
      }).pipe(Effect.provide(layer))
    }),
  )

  it.effect("put a refused routine change back at once", () =>
    Effect.gen(function* () {
      const layer = yield* harness(() => Effect.fail(new RefusedError({ reason: "routine", message: "No." })))
      yield* Effect.gen(function* () {
        const pending = yield* PendingCommands
        const server = user(5, { routine: [routine()] })
        yield* pending.user.reconcile("user", server, 5)
        const error = yield* updateRoutine({ id: "r1", status: "paused" }).pipe(Effect.flip)
        expect(error._tag).toBe("RefusedError")
        expect((yield* shownRows(server))?.routine?.map((r) => r.status)).toEqual(["active"])
      }).pipe(Effect.provide(layer))
    }),
  )

  it.effect("hide a cancelled routine until the server drops it", () =>
    Effect.gen(function* () {
      const layer = yield* harness(() => Effect.void)
      yield* Effect.gen(function* () {
        const pending = yield* PendingCommands
        const server = user(5, { routine: [routine()] })
        yield* pending.user.reconcile("user", server, 5)
        yield* cancelRoutine({ id: "r1" })
        expect((yield* shownRows(server))?.routine).toEqual([])
        yield* pending.user.reconcile("user", user(6, { routine: [] }), 6)
        expect(yield* pending.user.get("user")).toEqual([])
      }).pipe(Effect.provide(layer))
    }),
  )
})
