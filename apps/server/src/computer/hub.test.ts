import { assert, describe, it } from "@effect/vitest"
import { encodeBinary, IMAGE_REF } from "@kiko/computer/frame"
import { OLDEST_PROTOCOL, PROTOCOL } from "@kiko/computer/wire"
import type { AgentSlug, RoomId } from "@kiko/protocol"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as TestClock from "effect/testing/TestClock"
import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { ComputerHub, type HubDeps } from "./hub"
import { ComputerStore, type ComputerRow, type NewComputer } from "./store"
import type { PcTaken } from "./types"

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
    taken: () => {},
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
    taken: () => {},
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

type SentFrame = {
  t: string
  holder?: string
  on?: boolean
  id?: string
  terminal?: string
  data?: string
  bytes?: number
}

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
    get: (id: string) => ({ id, name: "box", os: "linux" }),
    list: () => ids.map((id) => ({ id, name: "box", os: "linux" })),
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
    taken: () => {},
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
  it.effect("welcomes a daemon that has not updated past the oldest protocol", () =>
    Effect.promise(async () => {
      const pc = pcSocket("pc-1")
      const computers = liveHub([], [pc.ws])

      await computers.message(pc.ws, JSON.stringify({ ...HELLO, protocol: OLDEST_PROTOCOL }))

      assert.deepStrictEqual(
        pc.sent.map((frame) => frame.t),
        ["welcome", "control"],
      )
    }),
  )

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
      const taking = computers.take("pc-1", viewing.ws)
      await computers.message(pc.ws, JSON.stringify({ t: "held", holder: "human", epoch: 1 }))
      assert.isTrue(await taking)

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

const onClock =
  (clock: Clock.Clock) =>
  (ms: number): Promise<void> =>
    Effect.runPromise(Effect.sleep(ms).pipe(Effect.provideService(Clock.Clock, clock)))

describe("the owned hold", () => {
  async function taken(computers: ReturnType<typeof liveHub>, ws: WebSocket, pc: ReturnType<typeof pcSocket>) {
    const taking = computers.take("pc-1", ws)
    await computers.message(pc.ws, JSON.stringify({ t: "held", holder: "human", epoch: 1 }))
    assert.isTrue(await taking)
  }

  const input = (text: string) => [{ k: "text" as const, s: text }]

  it.effect("waits for the daemon to acknowledge control before answering the take", () =>
    Effect.promise(async () => {
      const viewer = tab()
      const pc = pcSocket("pc-1")
      const computers = liveHub([viewer.ws], [pc.ws], ["pc-1"])
      await computers.message(pc.ws, JSON.stringify(HELLO))
      let done = false
      const taking = computers.take("pc-1", viewer.ws).then((ok) => {
        done = true
        return ok
      })

      await Promise.resolve()
      assert.isFalse(done)

      await computers.message(pc.ws, JSON.stringify({ t: "held", holder: "human", epoch: 1 }))
      assert.isTrue(await taking)
    }),
  )

  it.effect("answers the take after the cap when the daemon never acknowledges", () =>
    Effect.gen(function* () {
      const clock = yield* Clock.Clock
      const viewer = tab()
      const pc = pcSocket("pc-1")
      const computers = liveHub([viewer.ws], [pc.ws], ["pc-1"], onClock(clock))
      yield* Effect.promise(() => computers.message(pc.ws, JSON.stringify(HELLO)))
      let done = false
      const taking = computers.take("pc-1", viewer.ws).then((ok) => {
        done = true
        return ok
      })

      yield* Effect.yieldNow
      assert.isFalse(done)

      yield* TestClock.adjust("1 second")
      assert.isFalse(done)

      yield* TestClock.adjust("1 second")
      assert.isTrue(yield* Effect.promise(() => taking))
      assert.isTrue(done)
    }),
  )

  it.effect("takes input only from the tab that holds the screen", () =>
    Effect.promise(async () => {
      const first = tab()
      const second = tab()
      const pc = pcSocket("pc-1")
      const computers = liveHub([first.ws, second.ws], [pc.ws], ["pc-1"])
      await computers.message(pc.ws, JSON.stringify(HELLO))
      await taken(computers, first.ws, pc)

      assert.isTrue(computers.input("pc-1", computers.session(first.ws), input("mine")))
      assert.isFalse(computers.input("pc-1", computers.session(second.ws), input("theirs")))

      const frames = pc.sent.filter((frame) => frame.t === "input")
      assert.strictEqual(frames.length, 1)
    }),
  )

  it.effect("shows another tab as the other viewer and moves the hold when it takes over", () =>
    Effect.promise(async () => {
      const first = tab()
      const second = tab()
      const pc = pcSocket("pc-1")
      const computers = liveHub([first.ws, second.ws], [pc.ws], ["pc-1"])
      await computers.message(pc.ws, JSON.stringify(HELLO))
      await taken(computers, first.ws, pc)

      assert.strictEqual(computers.summaries(first.ws)[0]?.heldBy, "you")
      assert.strictEqual(computers.summaries(second.ws)[0]?.heldBy, "other")

      const taking = computers.take("pc-1", second.ws)
      await computers.message(pc.ws, JSON.stringify({ t: "held", holder: "human", epoch: 2 }))
      assert.isTrue(await taking)

      assert.strictEqual(computers.summaries(first.ws)[0]?.heldBy, "other")
      assert.isFalse(computers.input("pc-1", computers.session(first.ws), input("mine")))
      assert.isTrue(computers.input("pc-1", computers.session(second.ws), input("theirs")))
    }),
  )

  it.effect("refuses to release a hold another viewer owns", () =>
    Effect.promise(async () => {
      const first = tab()
      const second = tab()
      const pc = pcSocket("pc-1")
      const computers = liveHub([first.ws, second.ws], [pc.ws], ["pc-1"])
      await computers.message(pc.ws, JSON.stringify(HELLO))
      await taken(computers, first.ws, pc)

      assert.strictEqual(computers.releaseBy("pc-1", computers.session(second.ws)), "other")
      assert.strictEqual(computers.holder("pc-1"), "human")

      assert.strictEqual(computers.releaseBy("pc-1", computers.session(first.ws)), "ok")
      assert.strictEqual(computers.holder("pc-1"), "agent")
    }),
  )

  it.effect("wakes each linked agent once when the owner takes over", () =>
    Effect.promise(async () => {
      const first = tab()
      const second = tab()
      const pc = pcSocket("pc-1")
      const woken: { pcId: string; name: string; waiters: { slug: string; roomId: string }[]; epoch: number }[] = []
      const store = {
        get: (id: string) => ({ id, name: "box", os: "linux" }),
        list: () => [{ id: "pc-1", name: "box", os: "linux" }],
        caps: () => CAPS,
      }
      const computers = new ComputerHub({
        ctx: {
          getWebSockets: (tag: string) => (tag === "tab" ? [first.ws, second.ws] : [pc.ws]),
          getWebSocketAutoResponseTimestamp: () => null,
        },
        env: {},
        store,
        ownerId: "owner",
        released: () => {},
        taken: (out: PcTaken) => woken.push(out),
        wakeup: { set: () => Promise.resolve(), clear: () => Promise.resolve() },
      } as unknown as HubDeps)
      await computers.message(pc.ws, JSON.stringify(HELLO))
      computers.link("pc-1", { slug: "kiko" as AgentSlug, roomId: "01900000-0000-7000-8000-000000000001" as RoomId })
      computers.link("pc-1", { slug: "muse" as AgentSlug, roomId: "01900000-0000-7000-8000-000000000001" as RoomId })

      await taken(computers, first.ws, pc)
      const taking = computers.take("pc-1", second.ws)
      await computers.message(pc.ws, JSON.stringify({ t: "held", holder: "human", epoch: 2 }))
      assert.isTrue(await taking)

      assert.strictEqual(woken.length, 1)
      assert.deepStrictEqual(
        woken[0]?.waiters.map((waiter) => waiter.slug),
        ["kiko", "muse"],
      )
      assert.strictEqual(woken[0]?.name, "box")
    }),
  )
})

describe("computer pushes", () => {
  it.effect("retries a push the socket refused", () =>
    Effect.sync(() => {
      const sent: string[] = []
      let refuse = true
      let attachment: unknown = {
        user: { ready: true },
        rooms: {},
        rpc: [{ requestId: "1", stream: "user", cursor: 0 }],
      }
      const ws = {
        send: (text: string) => {
          if (refuse) {
            refuse = false
            throw new Error("socket closed")
          }
          sent.push(text)
        },
        serializeAttachment: (value: unknown) => {
          attachment = structuredClone(value)
        },
        deserializeAttachment: () => structuredClone(attachment),
        readyState: WebSocket.OPEN,
      } as unknown as WebSocket
      const computers = liveHub([ws], [], ["pc-1"])

      computers.push()
      computers.push()

      assert.strictEqual(sent.length, 1)
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
        taken: () => {},
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

const TERMINAL = { ...HELLO, caps: { ...CAPS, terminal: true } }

type ChunkFrame = { _tag: string; requestId: unknown; values: readonly { type: string; data?: string }[] }

function terminalTab() {
  const sent: unknown[] = []
  let attachment: unknown = { user: { ready: true }, rooms: {}, rpc: [] }
  const ws = {
    send: (text: string) => sent.push(JSON.parse(text)),
    serializeAttachment: (value: unknown) => {
      attachment = structuredClone(value)
    },
    deserializeAttachment: () => structuredClone(attachment),
    readyState: WebSocket.OPEN,
  } as unknown as WebSocket
  const chunks = () => sent as ChunkFrame[]
  return { ws, chunks }
}

function attach(computers: ReturnType<typeof liveHub>, pc: ReturnType<typeof pcSocket>, tab: WebSocket, id = "t-1") {
  const outcome = computers.attachTerminal(tab, "req-1", "pc-1", id, 100, 30)
  const frame = pc.sent.find((sent) => sent.t === "terminal" && sent.on === true)
  return { outcome, frame }
}

describe("terminal attach", () => {
  it.effect("asks the daemon for a terminal and streams its output to the tab", () =>
    Effect.promise(async () => {
      const pc = pcSocket("pc-1")
      const open = terminalTab()
      const computers = liveHub([open.ws], [pc.ws], ["pc-1"])
      await computers.message(pc.ws, JSON.stringify(TERMINAL))

      const { outcome, frame } = attach(computers, pc, open.ws)
      await computers.message(
        pc.ws,
        JSON.stringify({ t: "terminal", id: frame?.id, event: { type: "output", data: "hi" } }),
      )

      assert.isTrue(outcome.ok)
      assert.strictEqual(frame?.terminal, "t-1")
      assert.deepStrictEqual(open.chunks().at(-1), {
        _tag: "Chunk",
        requestId: "req-1",
        values: [{ type: "output", data: "hi" }],
      })
    }),
  )

  it.effect("refuses a computer that does not allow terminals", () =>
    Effect.promise(async () => {
      const pc = pcSocket("pc-1")
      const open = terminalTab()
      const computers = liveHub([open.ws], [pc.ws], ["pc-1"])
      await computers.message(pc.ws, JSON.stringify(HELLO))

      const { outcome } = attach(computers, pc, open.ws)

      assert.isFalse(outcome.ok)
      if (!outcome.ok) assert.match(outcome.message, /does not allow terminal sessions/)
    }),
  )

  it.effect("refuses a computer that is not connected", () =>
    Effect.promise(async () => {
      const open = terminalTab()
      const computers = liveHub([open.ws], [], ["pc-1"])

      const outcome = computers.attachTerminal(open.ws, "req-1", "pc-1", "t-1", 100, 30)

      assert.isFalse(outcome.ok)
      if (!outcome.ok) assert.match(outcome.message, /offline/)
    }),
  )

  it.effect("tells the tab when the daemon disconnects", () =>
    Effect.promise(async () => {
      const pc = pcSocket("pc-1")
      const open = terminalTab()
      const computers = liveHub([open.ws], [pc.ws], ["pc-1"])
      await computers.message(pc.ws, JSON.stringify(TERMINAL))
      attach(computers, pc, open.ws)

      await computers.close(pc.ws)

      assert.match(open.chunks().at(-1)?.values[0]?.type ?? "", /error/)
    }),
  )
})

describe("terminal control", () => {
  it.effect("refuses owner input until the owner takes over", () =>
    Effect.promise(async () => {
      const pc = pcSocket("pc-1")
      const open = terminalTab()
      const computers = liveHub([open.ws], [pc.ws], ["pc-1"])
      await computers.message(pc.ws, JSON.stringify(TERMINAL))
      attach(computers, pc, open.ws)

      const before = computers.terminalInput(open.ws, "pc-1", "t-1", "ls\r")
      computers.take("pc-1", open.ws)
      const after = computers.terminalInput(open.ws, "pc-1", "t-1", "ls\r")

      assert.isFalse(before.ok)
      assert.isTrue(after.ok)
      assert.isTrue(pc.sent.some((frame) => frame.t === "terminalInput" && frame.data === "ls\r"))
    }),
  )

  it.effect("refuses input from another tab while one tab holds control", () =>
    Effect.promise(async () => {
      const pc = pcSocket("pc-1")
      const mine = terminalTab()
      const other = terminalTab()
      const computers = liveHub([mine.ws, other.ws], [pc.ws], ["pc-1"])
      await computers.message(pc.ws, JSON.stringify(TERMINAL))
      attach(computers, pc, mine.ws)
      attach(computers, pc, other.ws)
      computers.take("pc-1", mine.ws)

      const typed = computers.terminalInput(other.ws, "pc-1", "t-1", "rm -rf /\r")

      assert.isFalse(typed.ok)
      if (!typed.ok) assert.match(typed.message, /another viewer has control/)
    }),
  )

  it.effect("refuses an agent terminal_send while the owner holds the terminal", () =>
    Effect.promise(async () => {
      const pc = pcSocket("pc-1")
      const open = terminalTab()
      const computers = liveHub([open.ws], [pc.ws], ["pc-1"])
      await computers.message(pc.ws, JSON.stringify(TERMINAL))
      computers.take("pc-1", open.ws)

      const outcome = await computers.call("pc-1", "terminal_send", { id: "t-1", text: "ls" })

      assert.isFalse(outcome.ok)
      if (!outcome.ok) {
        assert.strictEqual(outcome.code, "busy")
        assert.strictEqual(outcome.message, "the owner has control of this terminal")
      }
    }),
  )

  it.effect("detaches the daemon attach when the tab leaves", () =>
    Effect.promise(async () => {
      const pc = pcSocket("pc-1")
      const open = terminalTab()
      const computers = liveHub([open.ws], [pc.ws], ["pc-1"])
      await computers.message(pc.ws, JSON.stringify(TERMINAL))
      const { frame } = attach(computers, pc, open.ws)

      computers.leave(open.ws)

      assert.isTrue(pc.sent.some((sent) => sent.t === "terminal" && sent.on === false && sent.id === frame?.id))
    }),
  )
})
