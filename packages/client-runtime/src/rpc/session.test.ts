import { PROTOCOL, type RoomId, type UserSnapshot } from "@kiko/protocol"
import type { UserStreamItem } from "@kiko/protocol/rpc"
import { describe, expect, it } from "@effect/vitest"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Ref from "effect/Ref"
import * as Stream from "effect/Stream"
import * as Socket from "effect/socket/Socket"
import { OwnerEndpoint } from "../connection/endpoint"
import type { PreparedConnection } from "../connection/model"
import * as ConnectionWakeups from "../connection/wakeups"
import { layer as sessionLayer, RpcSessionFactory, UserFeed } from "./session"

const ROOM = "01890000-0000-7000-8000-000000000001" as RoomId

const PREPARED: PreparedConnection = {
  label: "Kiko",
  httpBaseUrl: "http://kiko.test",
  socketUrl: "ws://kiko.test/api/rpc",
  protocols: ["kiko", "token"],
}

const chat = (seq: number, title: string): UserSnapshot => ({
  seq,
  chats: [
    {
      roomId: ROOM,
      title,
      pinned: false,
      muted: false,
      lastSeq: seq,
      lastPreview: "See you at noon",
      unread: 0,
      updatedAt: seq,
    },
  ],
  home: { files: [], folders: [] },
})

const retitled = (seq: number, title: string): UserStreamItem => ({
  kind: "event",
  sequence: seq,
  event: { t: "chat", chat: chat(seq, title).chats[0]!, seq, at: seq, projection: true },
})

interface Sent {
  readonly id: string | number
  readonly tag: string
  readonly payload: unknown
}

const answerFor = (subscribes: ReadonlyArray<Sent>): ReadonlyArray<UserStreamItem> =>
  subscribes.length === 1
    ? [
        { kind: "snapshot", snapshot: chat(4, "Trip plans"), version: "0.9.0", protocol: PROTOCOL },
        { kind: "synchronized" },
      ]
    : [retitled(5, "Trip plans and tickets"), { kind: "synchronized" }]

function scriptedSocket(sent: Sent[], ends = false) {
  return Layer.succeed(Socket.WebSocketConstructor, () => {
    const listeners = new Map<string, (event: { data: string }) => void>()
    return {
      readyState: 1,
      addEventListener: (type: string, listener: (event: { data: string }) => void) => {
        listeners.set(type, listener)
      },
      removeEventListener: (type: string) => {
        listeners.delete(type)
      },
      close: () => {},
      send: (raw: string) => {
        const frame = JSON.parse(raw) as { _tag: string; id: string | number; tag: string; payload: unknown }
        if (frame._tag !== "Request") return
        sent.push({ id: frame.id, tag: frame.tag, payload: frame.payload })
        for (const value of answerFor(sent.filter((each) => each.tag === "user.subscribe")))
          listeners.get("message")?.({
            data: JSON.stringify({ _tag: "Chunk", requestId: frame.id, values: [value] }),
          })
        if (ends)
          listeners.get("message")?.({
            data: JSON.stringify({
              _tag: "Exit",
              requestId: frame.id,
              exit: { _tag: "Success", value: null },
            }),
          })
      },
    } as never
  })
}

const settle = Effect.repeat(Effect.yieldNow, { times: 50 })

const subscribes = (sent: ReadonlyArray<Sent>) => sent.filter((frame) => frame.tag === "user.subscribe")

describe("the user feed", () => {
  it.effect("replays the chat list from its own cursor when the tab comes back to the foreground", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const sent: Sent[] = []
        const applied = yield* Ref.make<ReadonlyArray<UserStreamItem>>([])
        const cursor = yield* Ref.make<number | undefined>(undefined)
        const wakeups = yield* Queue.unbounded<ConnectionWakeups.ConnectionWakeup>()
        const services = Layer.mergeAll(
          scriptedSocket(sent),
          Layer.succeed(
            OwnerEndpoint,
            OwnerEndpoint.of({ prepare: Effect.never, diagnose: () => Effect.succeed(null) }),
          ),
          Layer.succeed(
            UserFeed,
            UserFeed.of({
              afterSequence: Ref.get(cursor),
              apply: (items) =>
                Ref.update(applied, (all) => [...all, ...items]).pipe(
                  Effect.andThen(
                    Effect.forEach(items, (item) =>
                      item.kind === "snapshot" ? Ref.set(cursor, item.snapshot.seq) : Effect.void,
                    ),
                  ),
                ),
            }),
          ),
          ConnectionWakeups.layer({ changes: Stream.fromQueue(wakeups) }),
        )
        const context = yield* Layer.build(sessionLayer.pipe(Layer.provide(services)))
        const session = yield* Context.get(context, RpcSessionFactory).connect(PREPARED)
        yield* settle

        expect(subscribes(sent).map((frame) => frame.payload)).toEqual([{}])
        expect(yield* Ref.get(cursor)).toBe(4)

        yield* Queue.offer(wakeups, "application-active")
        yield* settle

        expect(subscribes(sent).map((frame) => frame.payload)).toEqual([{}, { afterSequence: 4 }])
        const titles = (yield* Ref.get(applied)).flatMap((item) =>
          item.kind === "snapshot"
            ? [item.snapshot.chats[0]?.title]
            : item.kind === "event" && item.event.t === "chat"
              ? [item.event.chat.title]
              : [],
        )
        expect(titles).toEqual(["Trip plans", "Trip plans and tickets"])

        yield* Queue.offer(wakeups, "network-changed")
        yield* settle
        expect(subscribes(sent)).toHaveLength(2)
        expect(session.closed).toBeDefined()
      }),
    ),
  )

  it.effect(
    "fails the session when the server ends the chat list, so the supervisor reconnects instead of idling",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const sent: Sent[] = []
          const services = Layer.mergeAll(
            scriptedSocket(sent, true),
            Layer.succeed(
              OwnerEndpoint,
              OwnerEndpoint.of({ prepare: Effect.never, diagnose: () => Effect.succeed(null) }),
            ),
            Layer.succeed(
              UserFeed,
              UserFeed.of({ afterSequence: Effect.succeed(undefined), apply: () => Effect.void }),
            ),
            ConnectionWakeups.layerNone,
          )
          const context = yield* Layer.build(sessionLayer.pipe(Layer.provide(services)))
          const session = yield* Context.get(context, RpcSessionFactory).connect(PREPARED)
          const error = yield* Effect.flip(session.closed)
          expect(error._tag).toBe("ConnectionTransientError")
          expect(error.message).toContain("closed your chat list")
        }),
      ),
  )
})
