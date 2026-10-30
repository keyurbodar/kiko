import { assert, describe, it } from "@effect/vitest"
import { PROTOCOL } from "@kiko/computer/wire"
import * as Effect from "effect/Effect"
import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { ComputerHub, type HubDeps } from "./hub"
import { ComputerStore, type ComputerRow, type NewComputer } from "./store"

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

const COMPUTERS = `CREATE TABLE computers (id TEXT PRIMARY KEY, name TEXT NOT NULL, public_key TEXT NOT NULL, os TEXT NOT NULL, arch TEXT NOT NULL, host TEXT NOT NULL, caps_json TEXT NOT NULL, pair_nonce TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL) WITHOUT ROWID`

function sqlite() {
  const db = new DatabaseSync(":memory:")
  db.exec(COMPUTERS)
  let written = 0
  const sql = {
    exec: (query: string, ...bindings: SQLInputValue[]) => {
      const statement = db.prepare(query)
      if (statement.columns().length > 0) {
        const rows = statement.all(...bindings)
        return { toArray: () => rows, rowsWritten: 0 }
      }
      const rowsWritten = Number(statement.run(...bindings).changes)
      written += rowsWritten
      return { toArray: () => [], rowsWritten }
    },
  } as unknown as SqlStorage
  return { sql, written: () => written }
}

function realHub(tabs: readonly WebSocket[]) {
  const db = sqlite()
  const deps = {
    ctx: { getWebSockets: (tag: string) => (tag === "tab" ? [...tabs] : []) },
    env: {},
    store: new ComputerStore(db.sql),
    ownerId: "owner",
    released: () => {},
    wakeup: { set: () => Promise.resolve(), clear: () => Promise.resolve() },
  } as unknown as HubDeps
  return { hub: new ComputerHub(deps), written: db.written }
}

const HELLO = {
  t: "hello",
  protocol: PROTOCOL,
  version: "1",
  os: "linux",
  arch: "x64",
  host: "box",
  caps: CAPS,
  displays: [],
} as const

describe("pairing again", () => {
  it.effect("replaces the computer this machine was paired as, in one push", () =>
    Effect.sync(() => {
      const open = tab()
      const { hub, written } = realHub([open.ws])
      hub.pair({ id: "pc-old", name: "box", publicKey: "old", pairNonce: "n1", hello: HELLO })
      const before = { pushes: open.sent.length, written: written() }

      const paired = hub.pair({
        id: "pc-new",
        name: "box",
        publicKey: "new",
        pairNonce: "n2",
        hello: HELLO,
        replaces: "pc-old",
      })

      assert.isTrue(paired)
      assert.deepStrictEqual(
        hub.rows().map((row) => row.id),
        ["pc-new"],
      )
      assert.strictEqual(open.sent.length - before.pushes, 1)
      assert.strictEqual(written() - before.written, 2)
    }),
  )

  it.effect("keeps every other computer when the replaced one is not on this worker", () =>
    Effect.sync(() => {
      const { hub } = realHub([])
      hub.pair({ id: "pc-a", name: "box", publicKey: "a", pairNonce: "n1", hello: HELLO })

      hub.pair({ id: "pc-b", name: "box", publicKey: "b", pairNonce: "n2", hello: HELLO, replaces: "pc-gone" })

      assert.deepStrictEqual(
        hub.rows().map((row) => row.id),
        ["pc-a", "pc-b"],
      )
    }),
  )

  it.effect("removes nothing when the pairing code was already used", () =>
    Effect.sync(() => {
      const { hub } = realHub([])
      hub.pair({ id: "pc-old", name: "box", publicKey: "old", pairNonce: "n1", hello: HELLO })

      const paired = hub.pair({
        id: "pc-new",
        name: "box",
        publicKey: "new",
        pairNonce: "n1",
        hello: HELLO,
        replaces: "pc-old",
      })

      assert.isFalse(paired)
      assert.deepStrictEqual(
        hub.rows().map((row) => row.id),
        ["pc-old"],
      )
    }),
  )
})

type SentFrame = { t: string; holder?: string; on?: boolean }

function pcSocket(id: string, holder: "agent" | "human" = "agent") {
  const sent: SentFrame[] = []
  let attachment: unknown = { kind: "pc", id, hello: null, holder, at: 1 }
  const ws = {
    send: (text: string) => sent.push(JSON.parse(text) as SentFrame),
    serializeAttachment: (value: unknown) => {
      attachment = structuredClone(value)
    },
    deserializeAttachment: () => structuredClone(attachment),
    readyState: WebSocket.OPEN,
    close: () => {},
  } as unknown as WebSocket
  return { ws, sent }
}

function liveHub(tabs: readonly WebSocket[], pcs: readonly WebSocket[], ids: readonly string[] = []) {
  const store = {
    get: (id: string) => ({ id, name: "box" }),
    list: () => ids.map((id) => ({ id, name: "box" })),
  }
  const deps = {
    ctx: {
      getWebSockets: (tag: string) => (tag === "tab" ? [...tabs] : [...pcs]),
      getWebSocketAutoResponseTimestamp: () => null,
    },
    env: {},
    store,
    ownerId: "owner",
    released: () => {},
    wakeup: { set: () => Promise.resolve(), clear: () => Promise.resolve() },
  } as unknown as HubDeps
  return new ComputerHub(deps)
}

describe("daemon reconnect", () => {
  it.effect("tells a reconnecting daemon who holds the screen", () =>
    Effect.promise(async () => {
      const pc = pcSocket("pc-1", "human")
      const computers = liveHub([], [pc.ws])

      await computers.message(pc.ws, JSON.stringify(HELLO))

      assert.deepStrictEqual(
        pc.sent.map((frame) => frame.t),
        ["welcome", "control"],
      )
      assert.strictEqual(pc.sent[1]?.holder, "human")
    }),
  )

  it.effect("arms the relay again when a disconnected daemon comes back", () =>
    Effect.promise(async () => {
      const watching = tab()
      watching.ws.serializeAttachment({
        user: { ready: true },
        rooms: {},
        rpc: [{ requestId: "9", stream: "pc:pc-1" }],
      })
      const first = pcSocket("pc-1")
      const pcs: WebSocket[] = [first.ws]
      const computers = liveHub([watching.ws], pcs)

      await computers.message(first.ws, JSON.stringify(HELLO))
      await computers.close(first.ws)
      const second = pcSocket("pc-1")
      pcs.splice(0, pcs.length, second.ws)
      await computers.message(second.ws, JSON.stringify(HELLO))

      assert.isTrue(first.sent.some((frame) => frame.t === "live" && frame.on === true))
      assert.isTrue(second.sent.some((frame) => frame.t === "live" && frame.on === true))
    }),
  )
})

describe("leaving the viewer", () => {
  it.effect("gives control back to the agent when the tab that held it goes away", () =>
    Effect.promise(async () => {
      const viewing = tab()
      viewing.ws.serializeAttachment({
        user: { ready: true },
        rooms: {},
        rpc: [{ requestId: "9", stream: "pc:pc-1" }],
      })
      const pc = pcSocket("pc-1")
      const computers = liveHub([viewing.ws], [pc.ws], ["pc-1"])
      const desktop = { ...HELLO, caps: { ...CAPS, desktop: true } }
      await computers.message(pc.ws, JSON.stringify(desktop))
      assert.isTrue(computers.take("pc-1", viewing.ws))

      const held = await computers.call("pc-1", "look", { maxWidth: "wide" })
      assert.deepStrictEqual(held, { ok: false, code: "busy", message: "the human has control of box right now" })

      computers.leave(viewing.ws)

      assert.strictEqual(computers.holder("pc-1"), "agent")
      const after = await computers.call("pc-1", "look", { maxWidth: "wide" })
      assert.deepStrictEqual(after, { ok: false, code: "failed", message: "bad look arguments" })
    }),
  )
})

describe("relay fallback", () => {
  it.effect("tells the daemon to share again when a new frame subscription arrives", () =>
    Effect.promise(async () => {
      const viewing = tab()
      viewing.ws.serializeAttachment({
        user: { ready: true },
        rooms: {},
        rpc: [{ requestId: "9", stream: "pc:pc-1" }],
      })
      const pc = pcSocket("pc-1")
      const computers = liveHub([viewing.ws], [pc.ws], ["pc-1"])
      await computers.message(pc.ws, JSON.stringify(HELLO))

      computers.syncRelay("pc-1")
      assert.strictEqual(pc.sent.filter((frame) => frame.t === "live").length, 1)

      computers.syncRelay("pc-1", true)

      const live = pc.sent.filter((frame) => frame.t === "live")
      assert.strictEqual(live.length, 2)
      assert.strictEqual(live[1]?.on, true)
    }),
  )
})

describe("computer calls", () => {
  it.effect("answers at once when the daemon is no longer answering", () =>
    Effect.promise(async () => {
      const pc = pcSocket("pc-1")
      const computers = liveHub([], [pc.ws])

      const outcome = await computers.call("pc-1", "shell", { command: "true" })

      assert.deepStrictEqual(outcome, { ok: false, code: "unsupported", message: "box is not connected" })
    }),
  )

  it.effect("counts a daemon online once it sends a frame, even with no auto-response timestamp", () =>
    Effect.promise(async () => {
      const pc = pcSocket("pc-1")
      const computers = liveHub([], [pc.ws])
      assert.isFalse(computers.online("pc-1"))

      await computers.message(pc.ws, JSON.stringify(HELLO))

      assert.isTrue(computers.online("pc-1"))
    }),
  )
})

describe("TURN credentials", () => {
  it.effect("gives the request a timeout and does not wedge later calls on a failed mint", () =>
    Effect.promise(async () => {
      let signal: AbortSignal | undefined
      let calls = 0
      const deps = {
        ctx: { getWebSockets: () => [] },
        env: { CF_TURN_KEY_ID: "key", CF_TURN_KEY_TOKEN: "token" },
        store: { get: () => null, list: () => [] },
        ownerId: "owner",
        released: () => {},
        wakeup: { set: () => Promise.resolve(), clear: () => Promise.resolve() },
        fetch: ((_url: string, init: RequestInit) => {
          calls += 1
          signal = init.signal ?? undefined
          return Promise.reject(new DOMException("The operation was aborted.", "AbortError"))
        }) as unknown as typeof fetch,
      } as unknown as HubDeps
      const computers = new ComputerHub(deps)

      const servers = await computers.iceServers()
      await computers.iceServers()

      assert.deepStrictEqual(servers, [{ urls: "stun:stun.cloudflare.com:3478" }])
      assert.isTrue(signal instanceof AbortSignal)
      assert.strictEqual(calls, 2)
    }),
  )
})
