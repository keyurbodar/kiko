import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { Envelope } from "@kiko/protocol"
import { Miniflare } from "miniflare"
import { MAX_ENTRY_BYTES, MAX_OPEN, RECLAIM_MS } from "@kiko/agent/inbox"
import { MAX_WAKEUPS } from "@kiko/durable/alarm"
import { HELLO_TIMEOUT_CODE, HELLO_TIMEOUT_MS } from "@kiko/durable/hello-deadline"
import { bundleWorker } from "./bundle"

let parts: Miniflare
let room: Miniflare
let user: Miniflare

beforeAll(async () => {
  const options = { modules: true, compatibilityDate: "2026-07-01", compatibilityFlags: ["nodejs_compat"] }
  parts = new Miniflare({
    ...options,
    script: await bundleWorker(new URL("./hardening-worker.ts", import.meta.url)),
    durableObjects: { H: { className: "H", useSQLite: true } },
  })
  room = new Miniflare({
    ...options,
    script: await bundleWorker(new URL("./room-worker.ts", import.meta.url)),
    durableObjects: { ROOM: { className: "RoomDO", useSQLite: true } },
  })
  user = new Miniflare({
    ...options,
    script: await bundleWorker(new URL("./user-worker.ts", import.meta.url)),
    durableObjects: { USER: { className: "UserDO", useSQLite: true } },
  })
}, 60_000)

afterAll(async () => {
  await Promise.all([parts?.dispose(), room?.dispose(), user?.dispose()])
})

let n = 0
const fresh = () => `h${++n}`

async function call<R = any>(id: string, op: string, args: Record<string, unknown> = {}): Promise<R> {
  const ns = await parts.getDurableObjectNamespace("H")
  const res = await ns.get(ns.idFromName(id)).fetch("http://do/", { method: "POST", body: JSON.stringify({ op, ...args }) })
  if (!res.ok) throw new Error(await res.text())
  return (await res.json()) as R
}

const envelope = (body = "hi", from: Envelope["from"] = { kind: "human" }): Envelope => ({
  id: `e${++n}`,
  roomId: "01J00000000000000000000000" as Envelope["roomId"],
  from,
  body,
  hop: 0,
  rootId: `r${n}`,
})

type Batch = { requestId: string; envelopes: Envelope[] }
const T0 = 1_000_000

describe("inbox entries in flight", () => {
  test("a run that dies after taking an entry gets it back after the timeout and handles it once", async () => {
    const id = fresh()
    const e = envelope("one")
    expect((await call(id, "admit", { envelopes: [e] })).inserted).toBe(1)

    const taken = await call<Batch[]>(id, "claim", { now: T0 })
    expect(taken.map((b) => b.envelopes.map((x) => x.id))).toEqual([[e.id]])

    expect(await call<Batch[]>(id, "claim", { now: T0 + RECLAIM_MS - 1 })).toEqual([])

    const back = await call<Batch[]>(id, "claim", { now: T0 + RECLAIM_MS })
    expect(back.map((b) => b.requestId)).toEqual([taken[0]!.requestId])

    expect(await call<boolean>(id, "submitted", { requestId: back[0]!.requestId })).toBe(true)
    expect(await call<boolean>(id, "submitted", { requestId: back[0]!.requestId })).toBe(false)
    expect(await call<Batch[]>(id, "claim", { now: T0 + 2 * RECLAIM_MS })).toEqual([])
    expect(await call(id, "counts")).toEqual({ waiting: 0, claimed: 0, submitted: 1 })
  })

  test("an entry taken by a process that is gone comes back at once", async () => {
    const id = fresh()
    const e = envelope("two")
    await call(id, "admit", { envelopes: [e] })
    const taken = await call<Batch[]>(id, "claim", { now: T0 })
    await call(id, "restart")
    const back = await call<Batch[]>(id, "claim", { now: T0 + 1 })
    expect(back.map((b) => b.requestId)).toEqual([taken[0]!.requestId])
    expect(await call<Batch[]>(id, "claim", { now: T0 + 2 })).toEqual([])
  })

  test("a repeated delivery of a handled entry stores nothing", async () => {
    const id = fresh()
    const e = envelope("three")
    await call(id, "admit", { envelopes: [e] })
    const [batch] = await call<Batch[]>(id, "claim", { now: T0 })
    await call(id, "submitted", { requestId: batch!.requestId })
    expect(await call(id, "admit", { envelopes: [e] })).toEqual({ admitted: [e.id], inserted: 0 })
    expect(await call<Batch[]>(id, "claim", { now: T0 + 2 * RECLAIM_MS })).toEqual([])
  })

  test("two worker reports that land while the lead is busy are one submission", async () => {
    const id = fresh()
    const first = envelope("job one done", { kind: "system", reason: "work" })
    const second = envelope("job two done", { kind: "system", reason: "work" })
    await call(id, "admit", { envelopes: [first] })
    await call(id, "admit", { envelopes: [second] })
    const claimed = await call<Batch[]>(id, "claim", { now: T0 })
    expect(claimed).toHaveLength(1)
    expect(claimed[0]!.envelopes.map((e) => e.id)).toEqual([first.id, second.id])
    expect(await call<Batch[]>(id, "claim", { now: T0 + 1 })).toEqual([])
  })
})

describe("inbox caps", () => {
  test("a full inbox refuses a delivery with a full reason and stores none of it", async () => {
    const id = fresh()
    const filler = Array.from({ length: MAX_OPEN - 1 }, () => envelope("x"))
    expect((await call(id, "admit", { envelopes: filler })).inserted).toBe(MAX_OPEN - 1)
    const two = [envelope("a"), envelope("b")]
    expect(await call(id, "admit", { envelopes: two })).toEqual({ admitted: [], inserted: 0, refused: "full" })
    expect((await call(id, "counts")).waiting).toBe(MAX_OPEN - 1)
    expect((await call(id, "admit", { envelopes: filler.slice(0, 3) })).admitted).toHaveLength(3)
    expect((await call(id, "admit", { envelopes: two.slice(0, 1) })).inserted).toBe(1)
    expect((await call(id, "admit", { envelopes: two.slice(1) })).refused).toBe("full")
  })

  test("submitted entries free the room they held", async () => {
    const id = fresh()
    await call(id, "admit", { envelopes: Array.from({ length: MAX_OPEN }, () => envelope("x")) })
    expect((await call(id, "admit", { envelopes: [envelope()] })).refused).toBe("full")
    const [batch] = await call<Batch[]>(id, "claim", { now: T0 })
    await call(id, "submitted", { requestId: batch!.requestId })
    expect((await call(id, "admit", { envelopes: [envelope()] })).inserted).toBe(1)
  })

  test("an entry past the size cap is refused", async () => {
    const id = fresh()
    const big = envelope("x".repeat(MAX_ENTRY_BYTES))
    expect(await call(id, "admit", { envelopes: [envelope(), big] })).toEqual({ admitted: [], inserted: 0, refused: "too_large" })
    expect(await call(id, "counts")).toEqual({ waiting: 0, claimed: 0, submitted: 0 })
  })
})

describe("wakeups", () => {
  test("the 1,001st wakeup on one object is refused, and an existing key still moves", async () => {
    const id = fresh()
    expect(await call(id, "wakeups", { prefix: "k", count: MAX_WAKEUPS + 1 })).toEqual({ stored: MAX_WAKEUPS, error: "WakeupLimitError" })
    await call(id, "move", { key: "k0", at: 6e12 })
    expect((await call(id, "due", { now: 5e12 + 10 })).keys).toHaveLength(10)
    expect(await call(id, "wakeups", { prefix: "new", count: 11 })).toEqual({ stored: 10, error: "WakeupLimitError" })
  }, 30_000)

})

describe("the worker's upgrade checks", () => {
  test("a session check that hangs answers 504 at the deadline", async () => {
    const { route, UPGRADE_TIMEOUT_MS } = await import("../src/router")
    const hang = () => new Promise<null>(() => {})
    const request = new Request("http://kiko.test/api/ws/user", { headers: { upgrade: "websocket" } })
    const start = Date.now()
    const response = await route(request, {} as never, hang)
    expect(response?.status).toBe(504)
    expect(Date.now() - start).toBeGreaterThanOrEqual(UPGRADE_TIMEOUT_MS - 200)
  }, 15_000)
})

type Opened = { ws: WebSocket; closed: Promise<{ code: number; reason: string; afterMs: number }> }

async function open(url: string): Promise<Opened> {
  const ws = new WebSocket(url)
  const start = Date.now()
  const closed = new Promise<{ code: number; reason: string; afterMs: number }>((resolve) => {
    ws.onclose = (e) => resolve({ code: e.code, reason: e.reason, afterMs: Date.now() - start })
  })
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  return { ws, closed }
}

const wsOrigin = async (mf: Miniflare) => (await mf.ready).origin.replace(/^http/, "ws")
const ROOM_ID = "01JZ8Q4T6M0000000000000099"

describe("the hello deadline", () => {
  test("a room socket that never sends hello is closed after 5 seconds, and one that does stays", async () => {
    const silent = await open(`${await wsOrigin(room)}/ws/${ROOM_ID}`)
    const polite = await open(`${await wsOrigin(room)}/ws/${ROOM_ID}`)
    polite.ws.send(JSON.stringify({ t: "hello", lastSeq: 0 }))
    const closed = await silent.closed
    expect(closed.code).toBe(HELLO_TIMEOUT_CODE)
    expect(closed.reason).toBe("no hello within 5 seconds")
    expect(closed.afterMs).toBeGreaterThanOrEqual(HELLO_TIMEOUT_MS - 200)
    expect(closed.afterMs).toBeLessThan(HELLO_TIMEOUT_MS + 3_000)
    expect(polite.ws.readyState).toBe(WebSocket.OPEN)
    polite.ws.close()
  }, 15_000)

  test("a user socket that never sends hello is closed after 5 seconds", async () => {
    const silent = await open(`${await wsOrigin(user)}/ws/${fresh()}`)
    const closed = await silent.closed
    expect(closed.code).toBe(HELLO_TIMEOUT_CODE)
    expect(closed.afterMs).toBeGreaterThanOrEqual(HELLO_TIMEOUT_MS - 200)
    expect(closed.afterMs).toBeLessThan(HELLO_TIMEOUT_MS + 3_000)
  }, 15_000)
})
