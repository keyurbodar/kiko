import { assert, describe, it } from "@effect/vitest"
import { encodeBinary, IMAGE_REF } from "@kiko/computer/frame"
import { PROTOCOL } from "@kiko/computer/wire"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as TestClock from "effect/testing/TestClock"
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
const DESKTOP = `CREATE TABLE computer_desktop (pc_id TEXT PRIMARY KEY, info TEXT NOT NULL) WITHOUT ROWID`

function sqlite() {
  const db = new DatabaseSync(":memory:")
  db.exec(COMPUTERS)
  db.exec(DESKTOP)
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

      assert.isTrue(paired.ok)
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

      hub.pair({ id: "pc-b", name: "crate", publicKey: "b", pairNonce: "n2", hello: HELLO, replaces: "pc-gone" })

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

      assert.isFalse(paired.ok)
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

function liveHub(
  tabs: readonly WebSocket[],
  pcs: readonly WebSocket[],
  ids: readonly string[] = [],
  sleep?: (ms: number) => Promise<void>,
) {
  const store = {
    get: (id: string) => ({ id, name: "box" }),
    list: () => ids.map((id) => ({ id, name: "box" })),
    caps: () => CAPS,
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
    ...(sleep ? { sleep } : {}),
  } as unknown as HubDeps
  return new ComputerHub(deps)
}

describe("unique names", () => {
  it.effect("refuses a second computer with a name another one already has", () =>
    Effect.sync(() => {
      const open = tab()
      const { hub, written } = realHub([open.ws])
      hub.pair({ id: "pc-a", name: "Box", publicKey: "a", pairNonce: "n1", hello: HELLO })
      const before = { pushes: open.sent.length, written: written() }

      const paired = hub.pair({ id: "pc-b", name: "box", publicKey: "b", pairNonce: "n2", hello: HELLO })

      assert.isFalse(paired.ok)
      if (paired.ok) return
      assert.match(paired.error, /pc-a/)
      assert.deepStrictEqual(
        hub.rows().map((row) => row.id),
        ["pc-a"],
      )
      assert.strictEqual(open.sent.length, before.pushes)
      assert.strictEqual(written(), before.written)
    }),
  )

  it.effect("refuses a rename to a name another computer already has", () =>
    Effect.sync(() => {
      const { hub } = realHub([])
      hub.pair({ id: "pc-a", name: "box", publicKey: "a", pairNonce: "n1", hello: HELLO })
      hub.pair({ id: "pc-b", name: "crate", publicKey: "b", pairNonce: "n2", hello: HELLO })

      const renamed = hub.rename("pc-b", "BOX")

      assert.isFalse(renamed.ok)
      if (renamed.ok) return
      assert.strictEqual(renamed.reason, "taken")
      assert.match(renamed.error, /pc-a/)
      assert.deepStrictEqual(
        hub.rows().map((row) => row.name),
        ["box", "crate"],
      )
    }),
  )
})

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

describe("resumable calls", () => {
  const SHELL = { exitCode: 0, output: "survived", truncated: false, timedOut: false }

  it.effect("keeps a running call pending through a reconnect and answers it once", () =>
    Effect.promise(async () => {
      const first = pcSocket("pc-1")
      const pcs: WebSocket[] = [first.ws]
      const computers = liveHub([], pcs, ["pc-1"])
      await computers.message(first.ws, JSON.stringify(HELLO))
      const outcome = computers.call("pc-1", "shell", { command: "build" })
      const id = callIds(first)[0]!

      await computers.close(first.ws)
      const second = pcSocket("pc-1")
      pcs.splice(0, pcs.length, second.ws)
      await computers.message(second.ws, JSON.stringify({ ...HELLO, resume: { running: [id], recent: [] } }))

      assert.deepStrictEqual(callIds(second), [])

      await computers.message(second.ws, JSON.stringify({ t: "result", id, ok: true, value: SHELL }))

      assert.deepStrictEqual(await outcome, { ok: true, value: SHELL })
    }),
  )

  it.effect("asks again for a call that finished during the gap and answers it from the daemon's recent result", () =>
    Effect.promise(async () => {
      const first = pcSocket("pc-1")
      const pcs: WebSocket[] = [first.ws]
      const computers = liveHub([], pcs, ["pc-1"])
      await computers.message(first.ws, JSON.stringify(HELLO))
      const outcome = computers.call("pc-1", "shell", { command: "build" })
      const id = callIds(first)[0]!

      await computers.close(first.ws)
      const second = pcSocket("pc-1")
      pcs.splice(0, pcs.length, second.ws)
      await computers.message(second.ws, JSON.stringify({ ...HELLO, resume: { running: [], recent: [id] } }))

      assert.deepStrictEqual(callIds(second), [id])

      await computers.message(second.ws, JSON.stringify({ t: "result", id, ok: true, value: SHELL }))

      assert.deepStrictEqual(await outcome, { ok: true, value: SHELL })
    }),
  )

  it.effect("sends a call the daemon never saw exactly once after the reconnect", () =>
    Effect.promise(async () => {
      const first = pcSocket("pc-1")
      const pcs: WebSocket[] = [first.ws]
      const computers = liveHub([], pcs, ["pc-1"])
      await computers.message(first.ws, JSON.stringify(HELLO))
      const outcome = computers.call("pc-1", "shell", { command: "build" })
      const id = callIds(first)[0]!

      await computers.close(first.ws)
      const second = pcSocket("pc-1")
      pcs.splice(0, pcs.length, second.ws)
      await computers.message(second.ws, JSON.stringify({ ...HELLO, resume: { running: [], recent: [] } }))
      await computers.message(second.ws, JSON.stringify({ t: "result", id, ok: true, value: SHELL }))

      assert.deepStrictEqual(callIds(second), [id])
      assert.deepStrictEqual(await outcome, { ok: true, value: SHELL })
    }),
  )

  it.effect("cancels pending calls when a daemon without a resume report reconnects", () =>
    Effect.promise(async () => {
      const first = pcSocket("pc-1")
      const pcs: WebSocket[] = [first.ws]
      const computers = liveHub([], pcs, ["pc-1"])
      await computers.message(first.ws, JSON.stringify(HELLO))
      const outcome = computers.call("pc-1", "shell", { command: "build" })

      await computers.close(first.ws)
      const second = pcSocket("pc-1")
      pcs.splice(0, pcs.length, second.ws)
      await computers.message(second.ws, JSON.stringify(HELLO))

      assert.deepStrictEqual(await outcome, { ok: false, code: "cancelled", message: "the computer reconnected" })
      assert.deepStrictEqual(callIds(second), [])
    }),
  )

  it.effect("sends a cancel for the call to the socket the computer reconnected with", () =>
    Effect.promise(async () => {
      const first = pcSocket("pc-1")
      const pcs: WebSocket[] = [first.ws]
      const computers = liveHub([], pcs, ["pc-1"])
      await computers.message(first.ws, JSON.stringify(HELLO))
      const abort = new AbortController()
      const outcome = computers.call("pc-1", "shell", { command: "build" }, { signal: abort.signal })
      const id = callIds(first)[0]!

      await computers.close(first.ws)
      const second = pcSocket("pc-1")
      pcs.splice(0, pcs.length, second.ws)
      await computers.message(second.ws, JSON.stringify({ ...HELLO, resume: { running: [id], recent: [] } }))
      abort.abort()

      const frames = second.sent as unknown as CallFrame[]
      assert.isTrue(frames.some((frame) => frame.t === "cancel" && frame.id === id))
      assert.deepStrictEqual(await outcome, { ok: false, code: "cancelled", message: "shell was cancelled" })
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
      const desktop = { ...HELLO, caps: { ...CAPS, desktop: true, background: true } }
      await computers.message(pc.ws, JSON.stringify(desktop))
      assert.isTrue(computers.take("pc-1", viewing.ws))

      const bad = { method: "desktop.call", params: { name: 5 } }
      const held = await computers.call("pc-1", "driver", bad)
      assert.deepStrictEqual(held, { ok: false, code: "busy", message: "the human has control of box right now" })

      computers.leave(viewing.ws)

      assert.strictEqual(computers.holder("pc-1"), "agent")
      const after = await computers.call("pc-1", "driver", bad)
      assert.deepStrictEqual(after, { ok: false, code: "failed", message: "bad driver arguments" })
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

const onClock =
  (clock: Clock.Clock) =>
  (ms: number): Promise<void> =>
    Effect.runPromise(Effect.sleep(ms).pipe(Effect.provideService(Clock.Clock, clock)))

describe("computer calls", () => {
  it.effect("waits for a computer that comes back, then runs the call", () =>
    Effect.gen(function* () {
      const clock = yield* Clock.Clock
      const pcs: WebSocket[] = []
      const computers = liveHub([], pcs, ["pc-1"], onClock(clock))

      const pending = computers.call("pc-1", "shell", { command: "true" })
      yield* Effect.yieldNow
      yield* TestClock.adjust("2 seconds")

      const pc = pcSocket("pc-1")
      pcs.push(pc.ws)
      yield* Effect.promise(() => computers.message(pc.ws, JSON.stringify(HELLO)))
      yield* Effect.yieldNow
      const id = callIds(pc)[0]
      assert.ok(id)
      yield* Effect.promise(() => settle(computers, pc.ws, id))

      assert.deepStrictEqual(yield* Effect.promise(() => pending), { ok: true, value: {} })
    }),
  )

  it.effect("says when a computer was last seen and why its connection ended", () =>
    Effect.gen(function* () {
      const clock = yield* Clock.Clock
      const pcs: WebSocket[] = []
      const computers = liveHub([], pcs, ["pc-1"], onClock(clock))
      const pc = pcSocket("pc-1")
      pcs.push(pc.ws)
      yield* Effect.promise(() => computers.message(pc.ws, JSON.stringify({ ...HELLO, version: "2.5.0" })))
      yield* Effect.promise(() => computers.close(pc.ws, 1006))
      pcs.splice(0)

      const pending = computers.call("pc-1", "shell", { command: "true" })
      yield* Effect.yieldNow
      yield* TestClock.adjust("5 seconds")
      const outcome = yield* Effect.promise(() => pending)

      assert.isFalse(outcome.ok)
      if (outcome.ok) return
      assert.strictEqual(outcome.code, "failed")
      assert.match(outcome.message, /box is offline/)
      assert.match(outcome.message, /last seen just now/)
      assert.match(outcome.message, /the network dropped/)
      assert.match(outcome.message, /2\.5\.0/)
    }),
  )

  it.effect("says a computer never connected when it has not said hello yet", () =>
    Effect.gen(function* () {
      const clock = yield* Clock.Clock
      const computers = liveHub([], [], ["pc-1"], onClock(clock))

      const pending = computers.call("pc-1", "shell", { command: "true" })
      yield* Effect.yieldNow
      yield* TestClock.adjust("5 seconds")
      const outcome = yield* Effect.promise(() => pending)

      assert.isFalse(outcome.ok)
      if (outcome.ok) return
      assert.match(outcome.message, /has not connected since it was paired/)
      assert.match(outcome.message, /daemon version is unknown/)
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

describe("computer summaries", () => {
  it.effect("carries the daemon version, last seen time and close reason", () =>
    Effect.gen(function* () {
      const clock = yield* Clock.Clock
      const pcs: WebSocket[] = []
      const computers = liveHub([], pcs, ["pc-1"], onClock(clock))
      const pc = pcSocket("pc-1")
      pcs.push(pc.ws)
      yield* Effect.promise(() => computers.message(pc.ws, JSON.stringify({ ...HELLO, version: "2.5.0" })))
      yield* Effect.promise(() => computers.close(pc.ws, 1006, "the network dropped."))
      pcs.splice(0)

      const [summary] = computers.summaries()

      assert.strictEqual(summary?.online, false)
      assert.strictEqual(summary?.version, "2.5.0")
      assert.strictEqual(summary?.lastCloseReason, "the network dropped")
      assert.isNumber(summary?.lastSeenAt)
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

const BACKGROUND = { ...HELLO, caps: { ...CAPS, background: true } }

describe("binary results", () => {
  it.effect("settles a call from a binary frame with the image bytes attached", () =>
    Effect.promise(async () => {
      const pc = pcSocket("pc-1")
      const computers = liveHub([], [pc.ws], ["pc-1"])
      await computers.message(pc.ws, JSON.stringify(HELLO))
      const outcome = computers.call("pc-1", "shell", { command: "shot" })
      const id = callIds(pc)[0]!
      const image = new Uint8Array([0xff, 0xd8, 1, 2])
      const header = {
        t: "result",
        id,
        ok: true,
        value: { content: [{ type: "image", data: { [IMAGE_REF]: 0 }, mimeType: "image/jpeg" }] },
        parts: [{ mime: "image/jpeg", length: image.byteLength }],
      }

      await computers.message(pc.ws, encodeBinary(header, image).buffer as ArrayBuffer)

      const result = await outcome
      assert.isTrue(result.ok)
      if (!result.ok) return
      const content = (result.value as { content: { data: Uint8Array }[] }).content
      assert.deepStrictEqual(content[0]?.data, image)
    }),
  )
})

type CallFrame = { t: string; id?: string; op?: string }

function callIds(socket: ReturnType<typeof pcSocket>): string[] {
  return socket.sent
    .map((frame) => frame as unknown as CallFrame)
    .filter((frame) => frame.t === "call")
    .map((frame) => frame.id ?? "")
}

async function settle(computers: ReturnType<typeof liveHub>, ws: WebSocket, id: string): Promise<void> {
  await computers.message(ws, JSON.stringify({ t: "result", id, ok: true, value: {} }))
}

const foreground = (mode: "background" | "foreground") => ({
  method: "browser.act",
  params: { tab: "t-1", ref: 1, action: "click", mode },
})

describe("driver desk", () => {
  it.effect("claims the desk for an on-screen step", () =>
    Effect.promise(async () => {
      const pc = pcSocket("pc-1")
      const computers = liveHub([], [pc.ws], ["pc-1"])
      await computers.message(pc.ws, JSON.stringify(BACKGROUND))

      const first = computers.call("pc-1", "driver", foreground("foreground"), {
        user: { key: "a", name: "kiko" },
      })
      const taken = await computers.call("pc-1", "driver", foreground("foreground"), {
        user: { key: "b", name: "other" },
      })

      assert.isFalse(taken.ok)
      assert.strictEqual(taken.code, "busy")

      const id = callIds(pc)[0]
      if (id) await settle(computers, pc.ws, id)
      assert.isTrue((await first).ok)
    }),
  )

  it.effect("leaves the desk alone for a background step", () =>
    Effect.promise(async () => {
      const pc = pcSocket("pc-1")
      const computers = liveHub([], [pc.ws], ["pc-1"])
      await computers.message(pc.ws, JSON.stringify(BACKGROUND))

      const first = computers.call("pc-1", "driver", foreground("background"), {
        user: { key: "a", name: "kiko" },
      })
      const second = computers.call("pc-1", "driver", foreground("foreground"), {
        user: { key: "b", name: "other" },
      })

      const ids = callIds(pc)
      assert.strictEqual(ids.length, 2)
      for (const id of ids) await settle(computers, pc.ws, id)
      assert.isTrue((await first).ok)
      assert.isTrue((await second).ok)
    }),
  )
})
