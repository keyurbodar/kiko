import { assert, describe, it } from "@effect/vitest"
import { NotFoundError } from "@kiko/protocol"
import * as Effect from "effect/Effect"
import { openAttachment, ownerAttachment } from "../owner/socket"
import { dispatch, type Context, type HandlerTable } from "./dispatcher"
import type { RpcHost } from "./handlers"

type Sent = Record<string, unknown>

function fakeSocket() {
  const sent: Sent[] = []
  let attachment: unknown = openAttachment(undefined)
  let closed: number | null = null
  const ws = {
    send: (text: string) => sent.push(JSON.parse(text) as Sent),
    close: (code: number) => {
      closed = code
    },
    serializeAttachment: (value: unknown) => {
      attachment = structuredClone(value)
    },
    deserializeAttachment: () => structuredClone(attachment),
  } as unknown as WebSocket
  return { ws, sent, closed: () => closed }
}

const host = {} as RpcHost

const run = (handlers: HandlerTable, frame: unknown) =>
  Effect.gen(function* () {
    const socket = fakeSocket()
    const cx: Context = { host, ws: socket.ws, socket: socket.ws }
    yield* Effect.promise(() => dispatch(handlers, cx, JSON.stringify(frame)))
    return socket
  })

const request = (tag: string, payload: unknown) => ({ _tag: "Request", id: "7", tag, payload, headers: [] })

describe("rpc dispatcher", () => {
  it.effect("answers a ping with the stock pong frame", () =>
    Effect.gen(function* () {
      const { sent } = yield* run({}, { _tag: "Ping" })
      assert.deepStrictEqual(sent, [{ _tag: "Pong" }])
    }),
  )

  it.effect("closes the socket on a frame that is not rpc json", () =>
    Effect.gen(function* () {
      const socket = fakeSocket()
      yield* Effect.promise(() => dispatch({}, { host, ws: socket.ws, socket: socket.ws }, "not json"))
      assert.strictEqual(socket.closed(), 1008)
    }),
  )

  it.effect("dies on a tag the contract does not have", () =>
    Effect.gen(function* () {
      const { sent } = yield* run({}, request("nope.never", {}))
      assert.deepStrictEqual(sent, [
        {
          _tag: "Exit",
          requestId: "7",
          exit: { _tag: "Failure", cause: [{ _tag: "Die", defect: "Kiko does not know nope.never." }] },
        },
      ])
    }),
  )

  it.effect("fails with a ProtocolError when the payload does not decode", () =>
    Effect.gen(function* () {
      const { sent } = yield* run({ "theme.set": () => Effect.void }, request("theme.set", { theme: 3 }))
      const exit = sent[0]?.exit as { cause: { _tag: string; error: { _tag: string } }[] }
      assert.strictEqual(exit.cause[0]?._tag, "Fail")
      assert.strictEqual(exit.cause[0]?.error._tag, "ProtocolError")
    }),
  )

  it.effect("encodes a handler's value as a success exit", () =>
    Effect.gen(function* () {
      const handlers: HandlerTable = { "files.token": () => Effect.succeed({ fileToken: "t" }) }
      const { sent } = yield* run(handlers, request("files.token", null))
      assert.deepStrictEqual(sent, [
        { _tag: "Exit", requestId: "7", exit: { _tag: "Success", value: { fileToken: "t" } } },
      ])
    }),
  )

  it.effect("encodes a contract error as a typed failure", () =>
    Effect.gen(function* () {
      const handlers: HandlerTable = {
        "chat.open": () => Effect.fail(new NotFoundError({ resource: "room", message: "That chat does not exist." })),
      }
      const roomId = "0199a0b0-0000-7000-8000-000000000000"
      const { sent } = yield* run(handlers, request("chat.open", { roomId }))
      assert.deepStrictEqual(sent[0]?.exit, {
        _tag: "Failure",
        cause: [
          { _tag: "Fail", error: { _tag: "NotFoundError", resource: "room", message: "That chat does not exist." } },
        ],
      })
    }),
  )

  it.effect("turns a defect into the storage error every rpc can fail with", () =>
    Effect.gen(function* () {
      const handlers: HandlerTable = { "settings.get": () => Effect.die(new Error("disk on fire")) }
      const { sent } = yield* run(handlers, request("settings.get", null))
      const exit = sent[0]?.exit as { cause: { error: { _tag: string; message: string } }[] }
      assert.deepStrictEqual(exit.cause[0]?.error, {
        _tag: "StorageError",
        message: "Kiko could not save that. Try again.",
      })
    }),
  )

  it.effect("keeps a stream open with no exit while its handler succeeds", () =>
    Effect.gen(function* () {
      const { sent } = yield* run({ "user.subscribe": () => Effect.void }, request("user.subscribe", {}))
      assert.deepStrictEqual(sent, [])
    }),
  )

  it.effect("drops the subscription when an interrupt arrives", () =>
    Effect.gen(function* () {
      const socket = fakeSocket()
      const cx: Context = { host, ws: socket.ws, socket: socket.ws }
      socket.ws.serializeAttachment({
        ...openAttachment(undefined),
        rpc: [{ requestId: "9", stream: "user", cursor: 0 }],
      })
      yield* Effect.promise(() => dispatch({}, cx, JSON.stringify({ _tag: "Interrupt", requestId: "9" })))
      assert.deepStrictEqual(ownerAttachment(socket.ws).rpc, [])
    }),
  )
})
