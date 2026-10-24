import { assert, describe, it } from "@effect/vitest"
import { PROTOCOL } from "@kiko/computer/wire"
import * as Effect from "effect/Effect"
import { ComputerHub, type HubDeps } from "./hub"
import type { ComputerRow, NewComputer } from "./store"

const CAPS = { shell: true, files: true, desktop: false, live: false, input: false }

type Frame = { _tag: string; requestId: unknown; values: readonly { kind: string; signal?: { t: string } }[] }

function tab() {
  const sent: Frame[] = []
  let attachment: unknown = { user: { ready: true }, rooms: {}, rpc: [{ requestId: "1", stream: "user", cursor: 0 }] }
  const ws = {
    send: (text: string) => sent.push(JSON.parse(text) as Frame),
    serializeAttachment: (value: unknown) => {
      attachment = structuredClone(value)
    },
    deserializeAttachment: () => structuredClone(attachment),
    readyState: WebSocket.OPEN,
  } as unknown as WebSocket
  return { ws, sent }
}

function hub(tabs: readonly WebSocket[]) {
  const rows: ComputerRow[] = []
  const store = {
    list: () => rows,
    get: (id: string) => rows.find((row) => row.id === id) ?? null,
    caps: () => CAPS,
    insert: (input: NewComputer) => {
      rows.push({
        id: input.id,
        name: input.name,
        public_key: input.publicKey,
        os: input.os,
        arch: input.arch,
        host: input.host,
        caps_json: JSON.stringify(input.caps),
        pair_nonce: input.pairNonce,
        created_at: input.at,
      })
      return true
    },
  }
  const deps = {
    ctx: { getWebSockets: (tag: string) => (tag === "tab" ? [...tabs] : []) },
    env: {},
    store,
    ownerId: "owner",
    released: () => {},
    wakeup: { set: () => Promise.resolve(), clear: () => Promise.resolve() },
  } as unknown as HubDeps
  return new ComputerHub(deps)
}

describe("computer list", () => {
  it.effect("sends a newly paired computer to open tabs as a user stream signal", () =>
    Effect.sync(() => {
      const open = tab()
      hub([open.ws]).pair({
        id: "pc-1",
        name: "mac",
        publicKey: "key",
        pairNonce: "nonce",
        hello: {
          t: "hello",
          protocol: PROTOCOL,
          version: "1",
          os: "macos",
          arch: "arm64",
          host: "mac",
          caps: CAPS,
          displays: [],
        },
      })

      assert.strictEqual(open.sent.length, 1)
      const frame = open.sent[0]
      assert.strictEqual(frame?._tag, "Chunk")
      assert.strictEqual(frame?.requestId, "1")
      assert.strictEqual(frame?.values[0]?.kind, "signal")
      assert.strictEqual(frame?.values[0]?.signal?.t, "pcState")
    }),
  )
})
