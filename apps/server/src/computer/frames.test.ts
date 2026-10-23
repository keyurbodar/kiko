import { assert, describe, it } from "@effect/vitest"
import { encodeFrame } from "@kiko/computer/frame"
import { ComputerFrame } from "@kiko/protocol"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { ComputerHub, type HubDeps } from "./hub"

const PC = "pc-1"
const IMAGE = Uint8Array.from({ length: 64 }, (_, i) => (i * 7) % 251)

type Sent = { requestId: unknown; values: readonly ComputerFrame[] }

function tab(subscriptions: readonly { requestId: string; stream: string }[]) {
  const sent: Sent[] = []
  let attachment: unknown = { user: { ready: true }, rooms: {}, rpc: subscriptions }
  const ws = {
    send: (text: string) => {
      const frame = JSON.parse(text) as { _tag: string; requestId: unknown; values: readonly ComputerFrame[] }
      assert.strictEqual(frame._tag, "Chunk")
      sent.push({ requestId: frame.requestId, values: frame.values })
    },
    serializeAttachment: (value: unknown) => {
      attachment = structuredClone(value)
    },
    deserializeAttachment: () => structuredClone(attachment),
    readyState: WebSocket.OPEN,
  } as unknown as WebSocket
  return { ws, sent }
}

const daemon = (id: string) => {
  let attachment: unknown = { kind: "pc", id, hello: null, holder: "agent", at: 0 }
  return {
    send: () => {},
    serializeAttachment: (value: unknown) => {
      attachment = structuredClone(value)
    },
    deserializeAttachment: () => structuredClone(attachment),
    readyState: WebSocket.OPEN,
  } as unknown as WebSocket
}

function hub(tabs: readonly WebSocket[], pcs: readonly WebSocket[] = []) {
  const ctx = { getWebSockets: (tag: string) => (tag === "tab" ? [...tabs] : [...pcs]) }
  const deps = {
    ctx,
    env: {},
    store: { get: () => null, list: () => [] },
    ownerId: "owner",
    released: () => {},
    wakeup: { set: () => Promise.resolve(), clear: () => Promise.resolve() },
  } as unknown as HubDeps
  return new ComputerHub(deps)
}

const frame = (seq: number) =>
  encodeFrame({ kind: "jpeg", width: 1280, height: 720, seq, cursor: { x: 0.25, y: 0.5 } }, IMAGE)

const decode = Schema.decodeUnknownSync(ComputerFrame)

describe("computer frame relay", () => {
  it.effect("sends a chunk only to the sockets subscribed to that computer", () =>
    Effect.gen(function* () {
      const watching = tab([{ requestId: "2", stream: `pc:${PC}` }])
      const wrong = tab([{ requestId: "3", stream: "pc:other" }])
      const plain = tab([{ requestId: "1", stream: "user" }])
      const computers = hub([watching.ws, wrong.ws, plain.ws], [daemon(PC)])
      yield* Effect.promise(() => computers.message(daemon(PC), frame(7).buffer as ArrayBuffer))

      assert.deepStrictEqual(wrong.sent, [])
      assert.deepStrictEqual(plain.sent, [])
      assert.strictEqual(watching.sent.length, 1)
      assert.strictEqual(watching.sent[0]?.requestId, "2")
      const sent = watching.sent[0]?.values[0]
      const decoded = decode(sent)
      assert.strictEqual(decoded.seq, 7)
      assert.strictEqual(decoded.mime, "image/jpeg")
      assert.strictEqual(decoded.width, 1280)
      assert.strictEqual(decoded.height, 720)
      assert.ok(decoded.cursor !== null)
      assert.ok(Math.abs(decoded.cursor.x - 0.25) < 0.001)
      assert.strictEqual(decoded.cursor.y, 0.5)
      assert.strictEqual(atob(decoded.data), String.fromCharCode(...IMAGE))
    }),
  )

  it.effect("sends nothing when no tab is watching", () =>
    Effect.gen(function* () {
      const plain = tab([{ requestId: "1", stream: "user" }])
      const computers = hub([plain.ws], [daemon(PC)])
      yield* Effect.promise(() => computers.message(daemon(PC), frame(8).buffer as ArrayBuffer))
      assert.deepStrictEqual(plain.sent, [])
    }),
  )

  it.effect("tells the daemon to start and stop the relay as watchers come and go", () =>
    Effect.sync(() => {
      const told: unknown[] = []
      const pc = daemon(PC)
      ;(pc as unknown as { send: (text: string) => void }).send = (text: string) => told.push(JSON.parse(text))
      const attached = tab([])
      const computers = hub([attached.ws], [pc])

      attached.ws.serializeAttachment({
        user: { ready: true },
        rooms: {},
        rpc: [{ requestId: "5", stream: `pc:${PC}` }],
      })
      computers.syncRelay(PC)
      computers.syncRelay(PC)
      attached.ws.serializeAttachment({ user: { ready: true }, rooms: {}, rpc: [] })
      computers.syncRelay(PC)

      assert.deepStrictEqual(told, [
        { t: "live", on: true, fps: 8, maxWidth: 1280, quality: 60 },
        { t: "live", on: false },
      ])
    }),
  )
})
